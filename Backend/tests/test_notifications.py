"""Unit tests for the admin-notification orchestration in reports.py.

Tests `_notify_admins_urgent_report` in isolation with mocked db and a
mocked Expo push module. Covers:
  - The coalesce window suppresses duplicate notifications per shelter+type
  - Closed and locked types coalesce independently
  - No-admins case is a graceful no-op
  - Admins without tokens are filtered out
  - The push payload uses the right title/body per type
  - NotificationLog is only written on a successful push
"""
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


SHELTER_ID = "65a1b2c3d4e5f6a7b8c9d0e2"
REPORT_ID = "65a1b2c3d4e5f6a7b8c9d0e3"


def _async_iter(items):
    class _AI:
        def __init__(self, data):
            self._it = iter(data)
        def __aiter__(self):
            return self
        async def __anext__(self):
            try:
                return next(self._it)
            except StopIteration:
                raise StopAsyncIteration
    return _AI(items)


def build_db_mock(*, admins=None, recent_log=None, shelter_name=""):
    """Mock db that backs the notification helper.

    - User.find(...)  yields the given admin docs
    - NotificationLog.find_one returns `recent_log` (or None)
    - NotificationLog.insert_one is a no-op recorder
    - ShelterTest.find_one returns a doc with the given `shelter_name`
    """
    admins = admins or []

    user_coll = MagicMock()
    user_coll.find = MagicMock(return_value=_async_iter(admins))

    notif_coll = MagicMock()
    notif_coll.find_one = AsyncMock(return_value=recent_log)
    notif_coll.insert_one = AsyncMock()

    shelter_coll = MagicMock()
    shelter_coll.find_one = AsyncMock(
        return_value={"name": shelter_name} if shelter_name else None
    )

    db = MagicMock()
    db.__getitem__.side_effect = lambda name: {
        "User": user_coll,
        "NotificationLog": notif_coll,
        "ShelterTest": shelter_coll,
    }[name]
    return db, notif_coll


# ── Coalescing ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_skips_when_recent_log_exists_for_same_shelter_and_type():
    """A recent NotificationLog entry should short-circuit the helper —
    no admin lookup, no push, no new log."""
    db, notif_coll = build_db_mock(
        recent_log={"shelterId": SHELTER_ID, "type": "closed"},
        admins=[{"expoPushToken": "ExponentPushToken[a]"}],
    )
    with patch("app.routes.reports.db", db), \
         patch("app.routes.reports.send_expo_push", new=AsyncMock(return_value=True)) as push_mock:
        from app.routes.reports import _notify_admins_urgent_report
        await _notify_admins_urgent_report(SHELTER_ID, "closed", REPORT_ID)

    push_mock.assert_not_called()
    notif_coll.insert_one.assert_not_called()


@pytest.mark.asyncio
async def test_closed_and_locked_coalesce_independently():
    """Recent 'closed' log must NOT suppress a 'locked' notification."""
    # Recent log is for 'closed' only — a fresh 'locked' should still send
    db, notif_coll = build_db_mock(
        recent_log=None,  # find_one matches on type too; for 'locked' search → no hit
        admins=[{"expoPushToken": "ExponentPushToken[a]"}],
        shelter_name="Test",
    )
    push_mock = AsyncMock(return_value=True)
    with patch("app.routes.reports.db", db), \
         patch("app.routes.reports.send_expo_push", new=push_mock):
        from app.routes.reports import _notify_admins_urgent_report
        await _notify_admins_urgent_report(SHELTER_ID, "locked", REPORT_ID)

    push_mock.assert_awaited_once()
    # The query passed to find_one must filter by type, so the implementation
    # naturally separates 'closed' vs 'locked'. Verify:
    coalesce_query = notif_coll.find_one.call_args.args[0]
    assert coalesce_query["type"] == "locked"


# ── Admin filtering ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_no_admins_with_tokens_is_a_noop():
    """If there are no admin push tokens, we don't call Expo or log."""
    db, notif_coll = build_db_mock(admins=[])  # no admins at all
    push_mock = AsyncMock(return_value=True)
    with patch("app.routes.reports.db", db), \
         patch("app.routes.reports.send_expo_push", new=push_mock):
        from app.routes.reports import _notify_admins_urgent_report
        await _notify_admins_urgent_report(SHELTER_ID, "closed", REPORT_ID)

    push_mock.assert_not_called()
    notif_coll.insert_one.assert_not_called()


@pytest.mark.asyncio
async def test_filters_admins_with_blank_tokens():
    """An admin doc with an empty token shouldn't sneak through."""
    admins = [
        {"expoPushToken": "ExponentPushToken[good1]"},
        {"expoPushToken": ""},          # blank — drop
        {"expoPushToken": "ExponentPushToken[good2]"},
    ]
    db, _ = build_db_mock(admins=admins, shelter_name="X")
    push_mock = AsyncMock(return_value=True)
    with patch("app.routes.reports.db", db), \
         patch("app.routes.reports.send_expo_push", new=push_mock):
        from app.routes.reports import _notify_admins_urgent_report
        await _notify_admins_urgent_report(SHELTER_ID, "closed", REPORT_ID)

    sent_tokens = push_mock.call_args.args[0]
    assert sent_tokens == [
        "ExponentPushToken[good1]",
        "ExponentPushToken[good2]",
    ]


# ── Copy per type ──────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_closed_report_uses_closed_copy():
    db, _ = build_db_mock(
        admins=[{"expoPushToken": "ExponentPushToken[a]"}],
        shelter_name="Beit Yosef",
    )
    push_mock = AsyncMock(return_value=True)
    with patch("app.routes.reports.db", db), \
         patch("app.routes.reports.send_expo_push", new=push_mock):
        from app.routes.reports import _notify_admins_urgent_report
        await _notify_admins_urgent_report(SHELTER_ID, "closed", REPORT_ID)

    _tokens, title, body, _data = push_mock.call_args.args
    assert title == "Closed shelter reported"
    assert "Beit Yosef" in body
    assert "closed" in body.lower()


@pytest.mark.asyncio
async def test_locked_report_uses_locked_copy():
    db, _ = build_db_mock(
        admins=[{"expoPushToken": "ExponentPushToken[a]"}],
        shelter_name="Beit Yosef",
    )
    push_mock = AsyncMock(return_value=True)
    with patch("app.routes.reports.db", db), \
         patch("app.routes.reports.send_expo_push", new=push_mock):
        from app.routes.reports import _notify_admins_urgent_report
        await _notify_admins_urgent_report(SHELTER_ID, "locked", REPORT_ID)

    _tokens, title, body, _data = push_mock.call_args.args
    assert title == "Locked shelter reported"
    assert "Beit Yosef" in body
    assert "locked" in body.lower()


@pytest.mark.asyncio
async def test_falls_back_when_shelter_name_missing():
    """Even without a shelter doc, we send something readable."""
    db, _ = build_db_mock(
        admins=[{"expoPushToken": "ExponentPushToken[a]"}],
        shelter_name="",  # no shelter in DB
    )
    push_mock = AsyncMock(return_value=True)
    with patch("app.routes.reports.db", db), \
         patch("app.routes.reports.send_expo_push", new=push_mock):
        from app.routes.reports import _notify_admins_urgent_report
        await _notify_admins_urgent_report(SHELTER_ID, "closed", REPORT_ID)

    _tokens, title, body, _data = push_mock.call_args.args
    assert title == "Closed shelter reported"
    assert "shelter" in body.lower()  # generic fallback string


# ── NotificationLog write ──────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_logs_on_successful_push():
    db, notif_coll = build_db_mock(
        admins=[{"expoPushToken": "ExponentPushToken[a]"}],
        shelter_name="X",
    )
    with patch("app.routes.reports.db", db), \
         patch("app.routes.reports.send_expo_push", new=AsyncMock(return_value=True)):
        from app.routes.reports import _notify_admins_urgent_report
        await _notify_admins_urgent_report(SHELTER_ID, "closed", REPORT_ID)

    notif_coll.insert_one.assert_awaited_once()
    logged = notif_coll.insert_one.call_args.args[0]
    assert logged["shelterId"] == SHELTER_ID
    assert logged["type"] == "closed"
    assert logged["recipientCount"] == 1
    assert logged["reportId"] == REPORT_ID
    assert isinstance(logged["sentAt"], datetime)


@pytest.mark.asyncio
async def test_does_not_log_on_failed_push():
    """If Expo rejects/errors, leaving the log empty preserves the user's
    ability to retry the next time someone reports the same shelter."""
    db, notif_coll = build_db_mock(
        admins=[{"expoPushToken": "ExponentPushToken[a]"}],
        shelter_name="X",
    )
    with patch("app.routes.reports.db", db), \
         patch("app.routes.reports.send_expo_push", new=AsyncMock(return_value=False)):
        from app.routes.reports import _notify_admins_urgent_report
        await _notify_admins_urgent_report(SHELTER_ID, "closed", REPORT_ID)

    notif_coll.insert_one.assert_not_called()


# ── Copy helper ─────────────────────────────────────────────────────────────

def test_urgent_copy_known_types():
    from app.routes.reports import _urgent_copy
    title, body = _urgent_copy("closed", "Beit X")
    assert title == "Closed shelter reported"
    assert "Beit X" in body

    title, body = _urgent_copy("locked", "Beit X")
    assert title == "Locked shelter reported"
    assert "Beit X" in body


def test_urgent_copy_unknown_type_falls_back():
    """If somehow an unexpected type gets here, we still produce non-empty text."""
    from app.routes.reports import _urgent_copy
    title, body = _urgent_copy("weird_type", "Beit X")
    assert title
    assert body
    assert "Beit X" in body
