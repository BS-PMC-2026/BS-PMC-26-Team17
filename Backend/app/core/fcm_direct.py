"""
Direct FCM V1 sender — workaround for an Expo Push bug.
========================================================

Expo's push service currently fails to route FCM V1 credentials for our
project (returns "InvalidCredentials" / "Unable to retrieve the FCM
server key") even though the service account is correctly uploaded and
authenticates fine when used directly. To unblock Android pushes we
bypass Expo for Android-registered devices and call FCM V1 ourselves
using the same service account.

iOS pushes continue to go through Expo (where Expo's APNs setup works).

────────────────────────────────────────────────────────────────────────
WHEN EXPO FIXES THE BUG — HOW TO TEST AND REMOVE THIS WORKAROUND
────────────────────────────────────────────────────────────────────────

  1. Pick a real Android `expoPushToken` from Mongo (User collection).
  2. Send a test push via Expo's API:
        & python -c "import asyncio, httpx, json
        async def main():
            async with httpx.AsyncClient() as c:
                r = await c.post('https://exp.host/--/api/v2/push/send', json=[{
                    'to': '<paste-token>',
                    'title': 'Expo health check',
                    'body':  'If you see this, Expo is fixed.',
                    'priority': 'high', 'channelId': 'default',
                }])
                print(json.dumps(r.json(), indent=2))
        asyncio.run(main())"
  3. If the response is {"status": "ok"} AND the phone buzzes → Expo is fixed.
     Revert this file's caller in alert_dispatcher.py to send via
     Expo only, drop the FCM-token registration on the frontend, and
     remove /auth/fcm-token endpoints. The tokens themselves stay in
     Mongo — no migration needed.
  4. Track Expo's fix: <PASTE EXPO ISSUE URL HERE WHEN FILED>

────────────────────────────────────────────────────────────────────────

Service-account loading:
  Prefers the env var FIREBASE_SERVICE_ACCOUNT_JSON (raw JSON content)
  so it works cleanly on Azure App Service. Falls back to a local file
  pointed to by FIREBASE_SERVICE_ACCOUNT_PATH (default:
  "firebase-service-account.json" relative to the Backend/ working dir).
"""

import asyncio
import json
import logging
import os
from typing import Any, Optional

import httpx
from google.oauth2 import service_account
import google.auth.transport.requests

log = logging.getLogger(__name__)


def _encode_for_fcm(value: Any) -> str:
    """
    FCM V1 requires every `data` value to be a string. Primitives convert
    cleanly with `str(...)`, but lists/dicts need JSON encoding so the
    frontend can `JSON.parse` them back — otherwise Python's repr leaks
    (`str(['x']) == "['x']"`) and the frontend can't parse it as an array.
    """
    if isinstance(value, (str, int, float, bool)) or value is None:
        return "" if value is None else str(value)
    return json.dumps(value, ensure_ascii=False)

# Lazy-loaded so the import doesn't crash if the JSON isn't present at
# startup — the dispatcher just won't be able to send via this path.
_creds: Optional[service_account.Credentials] = None
_project_id: Optional[str] = None


def _load_service_account() -> tuple[service_account.Credentials, str]:
    """Load + cache the service account credentials. Refresh on demand."""
    global _creds, _project_id
    if _creds is not None and _project_id is not None:
        return _creds, _project_id

    json_content = os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON")
    if json_content:
        sa = json.loads(json_content)
    else:
        path = os.getenv("FIREBASE_SERVICE_ACCOUNT_PATH", "firebase-service-account.json")
        with open(path) as f:
            sa = json.load(f)

    _creds = service_account.Credentials.from_service_account_info(
        sa,
        scopes=["https://www.googleapis.com/auth/firebase.messaging"],
    )
    _project_id = sa["project_id"]
    return _creds, _project_id


async def _send_one(
    client: httpx.AsyncClient,
    url: str,
    headers: dict,
    token: str,
    title: str,
    body: str,
    data: dict,
) -> bool:
    """Send a single FCM V1 message. Returns True on HTTP 200."""
    try:
        # FCM V1 requires all `data` values to be strings. Lists/dicts
        # are JSON-encoded so the frontend can parse them back.
        str_data = {str(k): _encode_for_fcm(v) for k, v in data.items()}
        resp = await client.post(url, headers=headers, json={
            "message": {
                "token": token,
                "notification": {"title": title, "body": body},
                "android": {"priority": "HIGH"},
                "data": str_data,
            }
        })
        if resp.status_code == 200:
            return True
        log.warning("[fcm-direct] %s: %s", resp.status_code, resp.text[:200])
    except Exception as e:
        log.warning("[fcm-direct] send failed for %s...: %s", token[:12], e)
    return False


async def send_fcm_direct(
    tokens: list[str],
    title: str,
    body: str,
    data: Optional[dict] = None,
) -> int:
    """
    Fan out a notification to a list of raw FCM device tokens by calling
    FCM V1 directly. Returns the count of tokens that returned HTTP 200.

    FCM V1 doesn't accept batch payloads the way Legacy did — one request
    per token — so we parallelize with asyncio.gather to keep latency low.
    """
    if not tokens:
        return 0

    try:
        creds, project_id = _load_service_account()
    except Exception as e:
        log.warning("[fcm-direct] failed to load service account: %s", e)
        return 0

    if not creds.valid:
        try:
            await asyncio.to_thread(creds.refresh, google.auth.transport.requests.Request())
        except Exception as e:
            log.warning("[fcm-direct] failed to refresh access token: %s", e)
            return 0

    url = f"https://fcm.googleapis.com/v1/projects/{project_id}/messages:send"
    headers = {
        "Authorization": f"Bearer {creds.token}",
        "Content-Type": "application/json",
    }
    payload_data = data or {}

    async with httpx.AsyncClient(timeout=15.0) as client:
        results = await asyncio.gather(
            *[_send_one(client, url, headers, t, title, body, payload_data) for t in tokens],
            return_exceptions=False,
        )
    return sum(1 for ok in results if ok)
