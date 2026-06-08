"""Phase 2a behavior tests.

Two focused tests:
  - Zone matching + siren carve-out: an early-warning alert in באר שבע
    is delivered only to users whose home resolves to a באר שבע sub-zone;
    a siren broadcasts to everyone regardless of home.
  - Coalescing: a second alert for the same (city, kind) within the
    window is fully suppressed; a second alert just outside the window
    fires again.
"""
import pytest
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

from app.core import alert_dispatcher, oref_zones


# ── Test fixtures ──────────────────────────────────────────────────────────

def _cursor(rows):
    class _AsyncCursor:
        def __init__(self, items): self._iter = iter(items)
        def __aiter__(self): return self
        async def __anext__(self):
            try: return next(self._iter)
            except StopIteration: raise StopAsyncIteration
    return _AsyncCursor(rows)


class _FakeLog:
    """In-memory stand-in for the AlertNotificationLog collection."""
    def __init__(self):
        self.rows = []
    def find(self, query, projection=None):
        cutoff = query["sentAt"]["$gte"]
        cities = set(query["city"]["$in"])
        kind = query["kind"]
        matching = [r for r in self.rows
                    if r["sentAt"] >= cutoff and r["city"] in cities and r["kind"] == kind]
        return _cursor(matching)
    async def insert_many(self, docs):
        self.rows.extend(docs)


def _patch_db(user_rows, log_coll):
    user_coll = MagicMock()
    user_coll.find = MagicMock(return_value=_cursor(user_rows))
    fake_db = MagicMock()
    def getitem(name):
        if name == "User":                 return user_coll
        if name == "AlertNotificationLog": return log_coll
        raise KeyError(name)
    fake_db.__getitem__.side_effect = getitem
    return fake_db


@pytest.fixture(autouse=True)
def _short_circuit_polygons():
    """
    Replace the polygon loader + zone resolver as imported by
    alert_dispatcher. BS coords resolve to a BS sub-zone, TA coords to a
    TA sub-zone, everything else is unknown.

    NOTE: we patch on alert_dispatcher (where it's imported from), not
    oref_zones (where it's defined). The dispatcher binds the symbol at
    import time, so patching the source module wouldn't take effect.
    """
    def fake_resolve(lat, lng):
        if 31.0 <= lat <= 31.5 and 34.6 <= lng <= 35.0:
            return "באר שבע - מערב"
        if 32.0 <= lat <= 32.2 and 34.7 <= lng <= 34.9:
            return "תל אביב - מרכז העיר"
        return None

    oref_zones.reset_for_tests(polygons={"_fake": [[0, 0], [0, 1], [1, 0]]})
    with patch.object(alert_dispatcher, "resolve_zone", side_effect=fake_resolve), \
         patch.object(alert_dispatcher, "load_polygons", AsyncMock(return_value={"_fake": []})):
        yield
    oref_zones.reset_for_tests(None)


# ── Tests ──────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_early_filters_by_home_city_siren_broadcasts():
    """Same set of users, same areas[], different alert kinds → different audiences."""
    users = [
        {"_id": "u1", "fcmToken": "fcm-bs",  "homeLat": 31.25, "homeLng": 34.79},  # BS
        {"_id": "u2", "fcmToken": "fcm-ta",  "homeLat": 32.08, "homeLng": 34.78},  # TA
        {"_id": "u3", "expoPushToken": "expo-no-home"},                            # no home
    ]

    fcm_mock  = AsyncMock(return_value=1)
    expo_mock = AsyncMock(return_value=True)

    # 1) Early warning for באר שבע — ONLY the BS user. The TA user is out of
    # zone, and the no-home user must be skipped: a northern pre-alarm should
    # not surface for a user whose home zone we can't resolve.
    log_coll = _FakeLog()
    with patch.object(alert_dispatcher, "db",              _patch_db(users, log_coll)), \
         patch.object(alert_dispatcher, "send_fcm_direct", fcm_mock), \
         patch.object(alert_dispatcher, "send_expo_push",  expo_mock):
        n = await alert_dispatcher.dispatch_alert({
            "id": "early-1", "kind": "early", "areas": ["באר שבע - מערב"],
        })

    assert n == 1  # BS user only
    assert sorted(fcm_mock.await_args.kwargs["tokens"]) == ["fcm-bs"]
    expo_mock.assert_not_awaited()  # no-home user must NOT receive a pre-alarm
    fcm_mock.reset_mock(); expo_mock.reset_mock()

    # 2) Siren for the same area — broadcasts: all three get it (no zone filter).
    # The no-home user still wakes for an actual rocket attack.
    log_coll = _FakeLog()
    users_again = [dict(u) for u in users]  # cursor is single-shot, reset
    with patch.object(alert_dispatcher, "db",              _patch_db(users_again, log_coll)), \
         patch.object(alert_dispatcher, "send_fcm_direct", fcm_mock), \
         patch.object(alert_dispatcher, "send_expo_push",  expo_mock):
        n = await alert_dispatcher.dispatch_alert({
            "id": "siren-1", "kind": "siren", "areas": ["באר שבע - מערב"],
        })

    assert n == 3
    assert sorted(fcm_mock.await_args.kwargs["tokens"]) == ["fcm-bs", "fcm-ta"]
    assert sorted(expo_mock.await_args.kwargs["tokens"]) == ["expo-no-home"]


@pytest.mark.asyncio
async def test_early_skips_user_inside_home_radius_but_siren_still_fires():
    """
    User is inside their home exclusion radius (lastGeofenceState='enter').
    A pre-alarm for their home city must NOT push — they're already at
    their safe space. A real siren for the same area still fires because
    the siren branch broadcasts unconditionally upstream.
    """
    users = [{
        "_id": "u1", "fcmToken": "fcm-bs-home",
        "homeLat": 31.25, "homeLng": 34.79,
        "lastGeofenceState": "enter",
    }]
    fcm_mock  = AsyncMock(return_value=1)
    expo_mock = AsyncMock(return_value=True)

    # Pre-alarm → suppressed.
    log_coll = _FakeLog()
    with patch.object(alert_dispatcher, "db",              _patch_db(users, log_coll)), \
         patch.object(alert_dispatcher, "send_fcm_direct", fcm_mock), \
         patch.object(alert_dispatcher, "send_expo_push",  expo_mock):
        n = await alert_dispatcher.dispatch_alert({
            "id": "early-home", "kind": "early", "areas": ["באר שבע - מערב"],
        })
    assert n == 0
    fcm_mock.assert_not_awaited()
    expo_mock.assert_not_awaited()

    # Siren for same area → fires, even though the user is at home.
    log_coll = _FakeLog()
    users_again = [dict(users[0])]
    with patch.object(alert_dispatcher, "db",              _patch_db(users_again, log_coll)), \
         patch.object(alert_dispatcher, "send_fcm_direct", fcm_mock), \
         patch.object(alert_dispatcher, "send_expo_push",  expo_mock):
        n = await alert_dispatcher.dispatch_alert({
            "id": "siren-home", "kind": "siren", "areas": ["באר שבע - מערב"],
        })
    assert n == 1
    assert fcm_mock.await_args.kwargs["tokens"] == ["fcm-bs-home"]


@pytest.mark.asyncio
async def test_early_still_pushes_when_user_outside_home_radius():
    """
    Same BS user, same area, but lastGeofenceState='exit' (out and about).
    The pre-alarm must reach them — they're away from their safe space
    and need the heads-up.
    """
    users = [{
        "_id": "u1", "fcmToken": "fcm-bs-away",
        "homeLat": 31.25, "homeLng": 34.79,
        "lastGeofenceState": "exit",
    }]
    fcm_mock  = AsyncMock(return_value=1)
    expo_mock = AsyncMock(return_value=True)
    log_coll = _FakeLog()

    with patch.object(alert_dispatcher, "db",              _patch_db(users, log_coll)), \
         patch.object(alert_dispatcher, "send_fcm_direct", fcm_mock), \
         patch.object(alert_dispatcher, "send_expo_push",  expo_mock):
        n = await alert_dispatcher.dispatch_alert({
            "id": "early-away", "kind": "early", "areas": ["באר שבע - מערב"],
        })

    assert n == 1
    assert fcm_mock.await_args.kwargs["tokens"] == ["fcm-bs-away"]


@pytest.mark.asyncio
async def test_early_skips_user_whose_home_does_not_resolve():
    """
    A user has homeLat/homeLng set but the coordinates don't fall inside any
    polygon (gap between sub-zones, road, polygon load failed mid-flight).
    A northern pre-alarm must NOT reach them — this is the exact symptom
    that prompted the fix.
    """
    users = [
        # Coords outside both ranges in the fake_resolve fixture → returns None.
        {"_id": "u1", "fcmToken": "fcm-stranded", "homeLat": 33.5, "homeLng": 35.5},
    ]
    fcm_mock  = AsyncMock(return_value=1)
    expo_mock = AsyncMock(return_value=True)
    log_coll = _FakeLog()

    with patch.object(alert_dispatcher, "db",              _patch_db(users, log_coll)), \
         patch.object(alert_dispatcher, "send_fcm_direct", fcm_mock), \
         patch.object(alert_dispatcher, "send_expo_push",  expo_mock):
        n = await alert_dispatcher.dispatch_alert({
            "id": "early-north", "kind": "early", "areas": ["צפת - מרכז"],
        })

    assert n == 0
    fcm_mock.assert_not_awaited()
    expo_mock.assert_not_awaited()


@pytest.mark.asyncio
async def test_coalescing_skips_second_alert_in_window_but_not_after():
    """
    First siren for באר שבע goes through. A second siren for the same city
    20 seconds later is coalesced. A third siren after the 30-second
    window fires again.
    """
    users = [{"_id": "u1", "fcmToken": "fcm-bs", "homeLat": 31.25, "homeLng": 34.79}]
    log_coll = _FakeLog()
    fcm_mock = AsyncMock(return_value=1)

    with patch.object(alert_dispatcher, "db",              _patch_db(users, log_coll)), \
         patch.object(alert_dispatcher, "send_fcm_direct", fcm_mock), \
         patch.object(alert_dispatcher, "send_expo_push",  AsyncMock()):

        # First siren — fires.
        n1 = await alert_dispatcher.dispatch_alert({
            "id": "s1", "kind": "siren", "areas": ["באר שבע - מערב"],
        })
        assert n1 == 1
        assert fcm_mock.await_count == 1

        # Second siren 20 seconds later for the same city — coalesced.
        # (Fake the log entry's age so we don't need to actually sleep.)
        log_coll.rows[0]["sentAt"] = datetime.now(timezone.utc) - timedelta(seconds=20)
        # Reset the cursor for the recipients query — it's single-shot.
        fake_db = _patch_db([dict(users[0])], log_coll)
        with patch.object(alert_dispatcher, "db", fake_db):
            n2 = await alert_dispatcher.dispatch_alert({
                "id": "s2", "kind": "siren", "areas": ["באר שבע - מזרח"],
            })
        assert n2 == 0
        assert fcm_mock.await_count == 1  # not called again

        # Third siren after the 30-second window — fires again.
        log_coll.rows[0]["sentAt"] = datetime.now(timezone.utc) - timedelta(seconds=60)
        fake_db = _patch_db([dict(users[0])], log_coll)
        with patch.object(alert_dispatcher, "db", fake_db):
            n3 = await alert_dispatcher.dispatch_alert({
                "id": "s3", "kind": "siren", "areas": ["באר שבע - דרום"],
            })
        assert n3 == 1
        assert fcm_mock.await_count == 2
