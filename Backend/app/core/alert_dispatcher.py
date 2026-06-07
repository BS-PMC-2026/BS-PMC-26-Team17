"""
Alert Dispatcher
----------------

Given a fresh Oref alert, decides who to push to and routes via the right
delivery path (FCM direct for Android tokens, Expo for the rest).

Phase 2a behavior:

  - **Sirens**: broadcast to every user with a token, no zone filtering.
    Missing a real siren is much worse than over-notifying.
  - **Early warnings**: filtered by home-zone (parent-city match). Users
    whose home is in a city affected by the alert get the push; users
    elsewhere do not. Users with no home set get the push (conservative
    fallback — we don't know where they are).

  Coalescing — to avoid spamming users when one event triggers multiple
  sub-zone alerts in quick succession:
    - Early warnings: 5-minute window per (parent_city, kind).
    - Sirens:         30-second window. Tight enough to merge near-
                      simultaneous fires from a single attack, loose
                      enough that a real second wave still wakes the user.

  Coalescing decision is per-city: if all cities affected by an alert
  were already pushed inside the window, skip the alert. If some are
  fresh, push (for sirens, to everyone; for early warnings, only to
  users whose home is in a fresh city).

  Each dispatch records one row per fresh (city, kind) in
  `AlertNotificationLog` so future dispatches can check the window.
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import Iterable

from app.core.database import db
from app.core.fcm_direct import send_fcm_direct
from app.core.oref_zones import (
    alert_matches_zone, load_polygons, parent_cities, parent_city, resolve_zone,
)
from app.routes.MessageAll.push import send_expo_push

log = logging.getLogger(__name__)


COALESCE_WINDOW_SECONDS = {
    "siren": 30,
    "early": 5 * 60,
}


def _title_for(kind: str) -> str:
    return "🚨 אזעקה" if kind == "siren" else "⚠️ התרעה מוקדמת"


def _body_for(areas: Iterable[str]) -> str:
    cleaned = [str(a).strip() for a in areas if a]
    if not cleaned:
        return "התרעה כעת באזורך"
    sample = ", ".join(cleaned[:8])
    if len(cleaned) > 8:
        sample += f" ועוד {len(cleaned) - 8}"
    return f"אזורים מושפעים: {sample}"


async def _recently_pushed_cities(cities: list[str], kind: str) -> set[str]:
    """Subset of `cities` already pushed for this `kind` within the window."""
    window = COALESCE_WINDOW_SECONDS.get(kind, 60)
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=window)
    if not cities:
        return set()
    hit: set[str] = set()
    async for row in db["AlertNotificationLog"].find(
        {"city": {"$in": cities}, "kind": kind, "sentAt": {"$gte": cutoff}},
        projection={"city": 1},
    ):
        c = row.get("city")
        if c:
            hit.add(c)
    return hit


async def _log_dispatched_cities(
    alert_id: str, kind: str, cities: list[str], recipient_count: int,
) -> None:
    """One row per city — the coalescing check queries by city."""
    if not cities:
        return
    now = datetime.now(timezone.utc)
    docs = [
        {
            "alertId":        alert_id,
            "city":           city,
            "kind":           kind,
            "sentAt":         now,
            "recipientCount": recipient_count,
        }
        for city in cities
    ]
    try:
        await db["AlertNotificationLog"].insert_many(docs)
    except Exception as e:
        log.warning("[dispatcher] failed to write AlertNotificationLog: %s", e)


async def _collect_recipients() -> list[dict]:
    """Users with at least one push token, including home coords."""
    out: list[dict] = []
    async for u in db["User"].find(
        {
            "$or": [
                {"expoPushToken": {"$exists": True, "$ne": None, "$ne": ""}},
                {"fcmToken":      {"$exists": True, "$ne": None, "$ne": ""}},
            ]
        },
        projection={
            "expoPushToken": 1, "fcmToken": 1,
            "homeLat": 1, "homeLng": 1,
        },
    ):
        out.append({
            "expoToken": u.get("expoPushToken") or None,
            "fcmToken":  u.get("fcmToken") or None,
            "homeLat":   u.get("homeLat"),
            "homeLng":   u.get("homeLng"),
        })
    return out


def _user_home_city(rec: dict) -> str:
    """The parent city of the user's home zone, or '' if unknown."""
    lat = rec.get("homeLat")
    lng = rec.get("homeLng")
    if not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
        return ""
    zone = resolve_zone(float(lat), float(lng))
    if not zone:
        return ""
    return parent_city(zone)


def _filter_for_early(
    recipients: list[dict], affected_cities: set[str],
) -> list[dict]:
    """
    For pre-alarms, keep recipients whose home city is in the affected set.
    Recipients with no resolvable home are kept (conservative fallback —
    rather over-notify than miss someone who didn't set their home).
    """
    out: list[dict] = []
    for r in recipients:
        home_city = _user_home_city(r)
        if not home_city:
            out.append(r)  # unknown home → notify just in case
            continue
        if home_city in affected_cities:
            out.append(r)
    return out


def _partition_tokens(recipients: list[dict]) -> tuple[list[str], list[str]]:
    """(fcm_tokens, expo_tokens) — FCM wins per user to avoid duplicates."""
    fcm:  list[str] = []
    expo: list[str] = []
    for r in recipients:
        if r["fcmToken"]:
            fcm.append(r["fcmToken"])
        elif r["expoToken"]:
            expo.append(r["expoToken"])
    return fcm, expo


async def dispatch_alert(alert: dict) -> int:
    """
    Phase 2a dispatch: filter (or broadcast for sirens), coalesce per
    (city, kind), partition tokens, and send. Returns total recipients
    actually pushed to (0 if fully coalesced).
    """
    try:
        alert_id   = str(alert.get("id") or "")
        alert_kind = str(alert.get("kind") or "siren")
        areas      = alert.get("areas") or []
        if not alert_id:
            return 0

        # Make sure the polygon dict is available so we can resolve users'
        # home zones. Skipped automatically if the load already happened.
        await load_polygons()

        # 1) Coalescing — which parent cities of this alert have we already
        #    pushed for, within the window?
        cities = parent_cities(areas)
        already = await _recently_pushed_cities(cities, alert_kind)
        fresh_cities = [c for c in cities if c not in already]
        if cities and not fresh_cities:
            log.info(
                "[dispatcher] alert %s fully coalesced (cities=%s, kind=%s)",
                alert_id, cities, alert_kind,
            )
            return 0

        # 2) Collect recipients
        recipients = await _collect_recipients()
        if not recipients:
            log.info("[dispatcher] alert %s: no recipients", alert_id)
            return 0

        # 3) Filter (or not, for sirens)
        if alert_kind == "siren":
            # Sirens broadcast — but only to people who haven't already been
            # pushed for the same overall event in this window. Since we
            # always pushed everyone for the prior firing, fresh_cities
            # being non-empty is enough to push everyone again.
            target = recipients
        else:
            affected = set(fresh_cities)
            target = _filter_for_early(recipients, affected)

        if not target:
            log.info("[dispatcher] alert %s: zone filter dropped all recipients", alert_id)
            return 0

        # 4) Build payload
        title = _title_for(alert_kind)
        body  = _body_for(areas)
        data  = {
            "type":      "oref-alert",
            "alertId":   alert_id,
            "alertKind": alert_kind,
            "areas":     list(areas),
        }

        # 5) Partition + dispatch
        fcm_tokens, expo_tokens = _partition_tokens(target)
        if fcm_tokens:
            await send_fcm_direct(tokens=fcm_tokens, title=title, body=body, data=data)
        if expo_tokens:
            await send_expo_push(tokens=expo_tokens, title=title, body=body, data=data)

        total = len(fcm_tokens) + len(expo_tokens)

        # 6) Audit log so future calls can see we covered these cities
        await _log_dispatched_cities(alert_id, alert_kind, fresh_cities, total)

        log.info(
            "[dispatcher] alert %s dispatched: fcm=%d expo=%d cities=%s (%s)",
            alert_id, len(fcm_tokens), len(expo_tokens), fresh_cities, alert_kind,
        )
        return total
    except Exception as e:
        log.warning("[dispatcher] failed to dispatch %s: %s", alert.get("id"), e)
        return 0
