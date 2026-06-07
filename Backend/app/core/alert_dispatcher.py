"""
Alert Dispatcher
----------------

Given a fresh Oref alert, finds every user with a registered push token
and fans out a notification.

Routing (workaround for Expo's FCM V1 bug — see app/core/fcm_direct.py):
  - If the user has a raw `fcmToken` (registered by the Android client),
    send via FCM V1 directly using our service account.
  - Otherwise fall back to the Expo Push API with their `expoPushToken`
    (works for iOS today, and for everyone once Expo fixes the bug).
  - A user with both fields gets exactly one push (FCM path wins).

Phase 1 scope: notify everyone. Phase 2 will add zone-based targeting
(only users whose home or last-known location is inside the alert area).
"""

import logging
from typing import Iterable

from app.core.database import db
from app.core.fcm_direct import send_fcm_direct
from app.routes.MessageAll.push import send_expo_push

log = logging.getLogger(__name__)


def _title_for(kind: str) -> str:
    return "🚨 אזעקה" if kind == "siren" else "⚠️ התרעה מוקדמת"


def _body_for(areas: Iterable[str]) -> str:
    """
    Compact Hebrew summary of the affected areas. Truncates so a long
    nationwide event doesn't blow past Expo's 4kB payload limit.
    """
    cleaned = [str(a).strip() for a in areas if a]
    if not cleaned:
        return "התרעה כעת באזורך"
    sample = ", ".join(cleaned[:8])
    if len(cleaned) > 8:
        sample += f" ועוד {len(cleaned) - 8}"
    return f"אזורים מושפעים: {sample}"


async def _collect_tokens() -> tuple[list[str], list[str]]:
    """
    Returns (fcm_tokens, expo_tokens) — partitioned by which delivery
    path the user should take. A user with both registered goes to FCM
    only (the workaround takes precedence; we don't want duplicates).
    """
    fcm_tokens:  list[str] = []
    expo_tokens: list[str] = []
    async for u in db["User"].find(
        {
            "$or": [
                {"expoPushToken": {"$exists": True, "$ne": None, "$ne": ""}},
                {"fcmToken":      {"$exists": True, "$ne": None, "$ne": ""}},
            ]
        },
        projection={"expoPushToken": 1, "fcmToken": 1},
    ):
        fcm  = u.get("fcmToken")
        expo = u.get("expoPushToken")
        if isinstance(fcm, str) and fcm:
            fcm_tokens.append(fcm)
        elif isinstance(expo, str) and expo:
            expo_tokens.append(expo)
    return fcm_tokens, expo_tokens


async def dispatch_alert(alert: dict) -> int:
    """
    Send the alert to every user with a push token. Returns the count of
    tokens we tried to push to (success != "delivered" — Expo handles
    that downstream). Returns 0 on no recipients or on error.
    """
    try:
        alert_id   = str(alert.get("id") or "")
        alert_kind = str(alert.get("kind") or "siren")
        areas      = alert.get("areas") or []
        if not alert_id:
            return 0

        fcm_tokens, expo_tokens = await _collect_tokens()
        total = len(fcm_tokens) + len(expo_tokens)
        if total == 0:
            log.info("[dispatcher] alert %s: no recipients", alert_id)
            return 0

        title = _title_for(alert_kind)
        body  = _body_for(areas)
        data  = {
            "type":      "oref-alert",
            "alertId":   alert_id,
            "alertKind": alert_kind,
            "areas":     list(areas),
        }

        # Both delivery paths can run in parallel — they touch different
        # external services and don't share state.
        if fcm_tokens:
            await send_fcm_direct(tokens=fcm_tokens, title=title, body=body, data=data)
        if expo_tokens:
            await send_expo_push(tokens=expo_tokens, title=title, body=body, data=data)
        log.info(
            "[dispatcher] alert %s dispatched: fcm=%d expo=%d",
            alert_id, len(fcm_tokens), len(expo_tokens),
        )
        return total
    except Exception as e:
        log.warning("[dispatcher] failed to dispatch %s: %s", alert.get("id"), e)
        return 0
