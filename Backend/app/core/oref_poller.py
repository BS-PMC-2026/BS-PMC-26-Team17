"""
Oref Alert Poller
-----------------

Server-side polling of Pikud HaOref's public alerts feed. Replaces the
"every client polls the same endpoint" model: one backend task watches
for alerts and fans them out to all registered users via push.

Why a server-side poller (instead of relying on each client's foreground
polling):
  - Reaches users when the app is backgrounded / on a non-map screen
  - Avoids waking N clients' radios for the same global event
  - Single source of truth for dedupe and audit

Error handling mirrors the reservation sweeper: transient network errors
log at INFO with a backoff cap so a brief outage doesn't spam the console.
"""

import asyncio
import logging
from typing import Optional, Set

import httpx

from app.core import alert_dispatcher

log = logging.getLogger(__name__)

# Pikud HaOref's public feed. Same URL the client polls.
OREF_URL = "https://www.oref.org.il/WarningMessages/alert/alerts.json"
POLL_INTERVAL_SECONDS = 3
MAX_BACKOFF_TICKS = 5

# Category codes Pikud HaOref uses for "early warning" (pre-alarm). Anything
# we don't recognise is treated as a siren — safer to over-alert than to
# silently miss an actual rocket warning.
EARLY_WARNING_CATS: Set[str] = {"13", "14"}


def _classify(raw: dict) -> str:
    """Return 'early' for cat 13/14 or matching titles, else 'siren'."""
    cat = str(raw.get("cat") or "")
    if cat in EARLY_WARNING_CATS:
        return "early"
    title = str(raw.get("title") or "")
    if "התרעה מוקדמת" in title or "early warning" in title.lower():
        return "early"
    return "siren"


def _parse_payload(raw_text: str) -> Optional[dict]:
    """
    Defensively parse Oref's response. Strips the BOM prefix Oref sometimes
    ships, treats empty `{}` as "no active alert", and returns None on
    anything malformed instead of raising.
    """
    if not raw_text:
        return None
    # BOM prefix (﻿) breaks json.loads if not stripped.
    if raw_text.startswith("﻿"):
        raw_text = raw_text[1:]
    raw_text = raw_text.strip()
    if not raw_text:
        return None
    import json
    try:
        data = json.loads(raw_text)
    except Exception:
        return None
    if not isinstance(data, dict):
        return None
    return data


class _PollerState:
    """Tiny holder for the in-memory dedupe id; module-level so tests can reset it."""
    last_seen_id: Optional[str] = None


def reset_for_tests() -> None:
    """Test helper: clear the dedupe id so two test runs can reuse alert ids."""
    _PollerState.last_seen_id = None


async def fetch_oref_alert(client: httpx.AsyncClient) -> Optional[dict]:
    """One HTTP request to Oref. Returns the parsed dict or None."""
    res = await client.get(
        OREF_URL,
        headers={
            "X-Requested-With": "XMLHttpRequest",
            "Accept": "application/json",
            # Oref sometimes returns gzipped content; httpx handles transparently.
        },
        timeout=10.0,
    )
    if res.status_code != 200:
        return None
    return _parse_payload(res.text)


async def poll_once(client: httpx.AsyncClient) -> Optional[dict]:
    """
    Single poll tick. Fetches, dedupes by `id`, classifies, dispatches.
    Returns the dispatched alert dict (for tests / logs) or None if nothing
    new fired this tick.
    """
    data = await fetch_oref_alert(client)
    if not data or not data.get("id"):
        return None
    alert_id = str(data["id"])
    if alert_id == _PollerState.last_seen_id:
        return None
    _PollerState.last_seen_id = alert_id

    raw_areas = data.get("data")
    areas = [str(a) for a in raw_areas] if isinstance(raw_areas, list) else []
    alert = {
        "id":    alert_id,
        "kind":  _classify(data),
        "title": str(data.get("title") or "אזעקה"),
        "areas": areas,
    }

    # Fire-and-forget dispatch — failures are logged inside the dispatcher.
    await alert_dispatcher.dispatch_alert(alert)
    return alert


async def poller_loop(interval_seconds: int = POLL_INTERVAL_SECONDS) -> None:
    """
    Long-running task — call from the FastAPI startup hook. Survives
    transient network errors with a capped backoff so a DNS hiccup doesn't
    spam the console.
    """
    log.info("[oref-poller] starting (interval=%ss)", interval_seconds)
    backoff = 0
    async with httpx.AsyncClient() as client:
        while True:
            try:
                await poll_once(client)
                backoff = 0  # success → reset
            except (httpx.ConnectError, httpx.ReadError, httpx.ReadTimeout, httpx.RemoteProtocolError) as e:
                backoff = min(backoff + 1, MAX_BACKOFF_TICKS)
                log.info(
                    "[oref-poller] oref unreachable (tick %d/%d): %s",
                    backoff, MAX_BACKOFF_TICKS, e,
                )
            except Exception as e:
                log.warning("[oref-poller] tick failed: %s", e)
            await asyncio.sleep(interval_seconds * max(1, backoff))
