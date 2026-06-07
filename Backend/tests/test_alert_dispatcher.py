"""End-to-end test of the alert dispatcher.

Verifies the routing rules:
  - Users with `fcmToken` go through FCM V1 directly (workaround for
    Expo's bug — see Backend/app/core/fcm_direct.py).
  - Users with only `expoPushToken` go through Expo Push API.
  - A user with both fields is routed only via FCM (no duplicates).
"""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.core import alert_dispatcher


def _cursor(rows):
    """Async iterator stand-in for `db['User'].find(...)`."""
    class _AsyncCursor:
        def __init__(self, items):
            self._iter = iter(items)
        def __aiter__(self):
            return self
        async def __anext__(self):
            try:
                return next(self._iter)
            except StopIteration:
                raise StopAsyncIteration
    return _AsyncCursor(rows)


class _FakeLog:
    """In-memory stand-in for AlertNotificationLog. Empty by default."""
    def __init__(self):
        self.rows = []
    def find(self, query, projection=None):
        return _cursor(self.rows)
    async def insert_many(self, docs):
        self.rows.extend(docs)


def _patch_db(users_with_tokens):
    """Fake db with separate User + AlertNotificationLog collections."""
    user_coll = MagicMock()
    user_coll.find = MagicMock(return_value=_cursor(users_with_tokens))
    log_coll = _FakeLog()
    fake_db = MagicMock()
    def getitem(name):
        if name == "User":                 return user_coll
        if name == "AlertNotificationLog": return log_coll
        raise KeyError(name)
    fake_db.__getitem__.side_effect = getitem
    return fake_db


@pytest.fixture(autouse=True)
def _skip_polygon_load():
    """Phase 2a calls load_polygons at the top of dispatch — stub it out."""
    with patch.object(alert_dispatcher, "load_polygons", AsyncMock(return_value=None)), \
         patch.object(alert_dispatcher, "resolve_zone", return_value=None):
        yield


@pytest.mark.asyncio
async def test_dispatch_routes_fcm_vs_expo_correctly():
    """
    Four users:
      u1 — fcm only        → FCM direct
      u2 — expo only       → Expo
      u3 — both            → FCM only (no Expo duplicate)
      u4 — empty fcm, expo → Expo (fcm is empty string)
    """
    users = [
        {"_id": "u1", "fcmToken":      "fcm-aaa"},
        {"_id": "u2", "expoPushToken": "ExponentPushToken[bbb]"},
        {"_id": "u3", "fcmToken":      "fcm-ccc", "expoPushToken": "ExponentPushToken[ccc]"},
        {"_id": "u4", "fcmToken":      "",        "expoPushToken": "ExponentPushToken[ddd]"},
    ]

    fcm_mock  = AsyncMock(return_value=2)
    expo_mock = AsyncMock(return_value=True)
    alert = {"id": "12345", "kind": "siren", "areas": ["באר שבע"]}

    with patch.object(alert_dispatcher, "db", _patch_db(users)), \
         patch.object(alert_dispatcher, "send_fcm_direct", fcm_mock), \
         patch.object(alert_dispatcher, "send_expo_push",  expo_mock):
        result = await alert_dispatcher.dispatch_alert(alert)

    assert result == 4

    fcm_mock.assert_awaited_once()
    fcm_tokens = fcm_mock.await_args.kwargs["tokens"]
    assert sorted(fcm_tokens) == ["fcm-aaa", "fcm-ccc"]
    assert fcm_mock.await_args.kwargs["title"].startswith("🚨")
    assert fcm_mock.await_args.kwargs["data"]["alertId"] == "12345"

    expo_mock.assert_awaited_once()
    expo_tokens = expo_mock.await_args.kwargs["tokens"]
    # u3 had both → FCM wins, no Expo duplicate.
    assert sorted(expo_tokens) == sorted([
        "ExponentPushToken[bbb]", "ExponentPushToken[ddd]",
    ])


@pytest.mark.asyncio
async def test_dispatch_noops_when_no_recipients():
    """No users with any token → neither path called."""
    fcm_mock  = AsyncMock()
    expo_mock = AsyncMock()
    with patch.object(alert_dispatcher, "db", _patch_db([])), \
         patch.object(alert_dispatcher, "send_fcm_direct", fcm_mock), \
         patch.object(alert_dispatcher, "send_expo_push",  expo_mock):
        result = await alert_dispatcher.dispatch_alert({
            "id": "9", "kind": "early", "areas": []
        })

    assert result == 0
    fcm_mock.assert_not_awaited()
    expo_mock.assert_not_awaited()
