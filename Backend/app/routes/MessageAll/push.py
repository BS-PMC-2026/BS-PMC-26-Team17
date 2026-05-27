"""Expo Push API client.

Sends notifications to one or many Expo push tokens by POSTing to Expo's
push service. Expo forwards to FCM (Android) / APNs (iOS) on our behalf.

Docs: https://docs.expo.dev/push-notifications/sending-notifications/
"""
import httpx

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
# Expo allows up to 100 messages per request; we never approach this limit.
EXPO_BATCH_LIMIT = 100


async def send_expo_push(
    tokens: list[str],
    title: str,
    body: str,
    data: dict | None = None,
) -> bool:
    """Send the same notification to a list of Expo push tokens.

    Returns True if the request reached Expo successfully (does not guarantee
    delivery — Expo handles retry/fan-out to FCM/APNs). Failures are logged
    but never raised, since this is called from a background task and must
    not break the originating request.
    """
    valid_tokens = [t for t in tokens if t and t.startswith("ExponentPushToken[")]
    if not valid_tokens:
        return False

    messages = [
        {
            "to": token,
            "sound": "default",
            "title": title,
            "body": body,
            "data": data or {},
            "priority": "high",
            # Group on Android so coalesced alerts appear under the same thread
            "channelId": "default",
        }
        for token in valid_tokens[:EXPO_BATCH_LIMIT]
    ]

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.post(EXPO_PUSH_URL, json=messages)
            if r.status_code != 200:
                print(f"[push] Expo returned {r.status_code}: {r.text[:200]}")
                return False
            return True
    except Exception as e:
        # Network error, DNS, timeout — log and move on
        print(f"[push] Expo push failed: {e}")
        return False
