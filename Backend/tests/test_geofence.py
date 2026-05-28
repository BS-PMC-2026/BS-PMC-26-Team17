"""Tests for /api/geofence/event.

Mock db and send_expo_push at the seams so we exercise the real route
without touching MongoDB or the network. Covers:
  - Successful exit/enter pushes and writes lastGeofenceState
  - Duplicate event of the same kind is deduped (status=duplicate)
  - User missing a push token returns no_token (state still updated)
  - Invalid user id returns 400
  - Unknown user returns 404
  - The push payload includes the geofence event in `data`
"""
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from bson import ObjectId
from httpx import AsyncClient, ASGITransport

from app.main import app


def _user_doc(*, push_token: str | None = "ExponentPushToken[u1]",
              last_state: str | None = None,
              role: str = "user"):
    doc = {
        "_id": ObjectId(),
        "email": "u@example.com",
        "role": role,
    }
    if push_token:
        doc["expoPushToken"] = push_token
    if last_state:
        doc["lastGeofenceState"] = last_state
    return doc


def _build_db(user_doc):
    user_coll = MagicMock()
    user_coll.find_one = AsyncMock(return_value=user_doc)
    user_coll.update_one = AsyncMock(return_value=MagicMock(matched_count=1))

    db = MagicMock()
    db.__getitem__.side_effect = lambda name: {"User": user_coll}[name]
    return db, user_coll


@pytest.fixture
def client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.mark.asyncio
async def test_exit_event_pushes_and_writes_state(client):
    user = _user_doc()
    db, user_coll = _build_db(user)
    push_mock = AsyncMock(return_value=True)

    with patch("app.routes.MessageAll.geofence.db", db), \
         patch("app.routes.MessageAll.geofence.send_expo_push", new=push_mock):
        async with client as c:
            r = await c.post(
                "/api/geofence/event",
                json={"user_id": str(user["_id"]), "event": "exit"},
            )

    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["sent"] is True

    # lastGeofenceState was persisted
    user_coll.update_one.assert_awaited_once()
    args, _ = user_coll.update_one.call_args
    assert args[1] == {"$set": {"lastGeofenceState": "exit"}}

    # Push went to the user's single token with the correct payload
    push_mock.assert_awaited_once()
    p_args, _ = push_mock.call_args
    assert p_args[0] == ["ExponentPushToken[u1]"]
    assert "safe zone" in p_args[1].lower() or "safe zone" in p_args[2].lower()
    data = p_args[3]
    assert data == {"type": "geofence", "event": "exit"}


@pytest.mark.asyncio
async def test_enter_event_uses_different_copy(client):
    user = _user_doc()
    db, _ = _build_db(user)
    push_mock = AsyncMock(return_value=True)

    with patch("app.routes.MessageAll.geofence.db", db), \
         patch("app.routes.MessageAll.geofence.send_expo_push", new=push_mock):
        async with client as c:
            r = await c.post(
                "/api/geofence/event",
                json={"user_id": str(user["_id"]), "event": "enter"},
            )

    assert r.status_code == 200
    push_mock.assert_awaited_once()
    p_args, _ = push_mock.call_args
    assert p_args[3] == {"type": "geofence", "event": "enter"}


@pytest.mark.asyncio
async def test_duplicate_event_is_deduped(client):
    """If lastGeofenceState already equals the incoming event, no push."""
    user = _user_doc(last_state="exit")
    db, user_coll = _build_db(user)
    push_mock = AsyncMock(return_value=True)

    with patch("app.routes.MessageAll.geofence.db", db), \
         patch("app.routes.MessageAll.geofence.send_expo_push", new=push_mock):
        async with client as c:
            r = await c.post(
                "/api/geofence/event",
                json={"user_id": str(user["_id"]), "event": "exit"},
            )

    assert r.status_code == 200
    assert r.json() == {"status": "duplicate", "sent": False}
    push_mock.assert_not_awaited()
    user_coll.update_one.assert_not_called()


@pytest.mark.asyncio
async def test_user_without_token_returns_no_token(client):
    """State must still be persisted even when there's no token to push to."""
    user = _user_doc(push_token=None)
    db, user_coll = _build_db(user)
    push_mock = AsyncMock(return_value=True)

    with patch("app.routes.MessageAll.geofence.db", db), \
         patch("app.routes.MessageAll.geofence.send_expo_push", new=push_mock):
        async with client as c:
            r = await c.post(
                "/api/geofence/event",
                json={"user_id": str(user["_id"]), "event": "exit"},
            )

    assert r.status_code == 200
    assert r.json() == {"status": "no_token", "sent": False}
    push_mock.assert_not_awaited()
    user_coll.update_one.assert_awaited_once()


@pytest.mark.asyncio
async def test_invalid_user_id_returns_400(client):
    db, _ = _build_db(_user_doc())
    with patch("app.routes.MessageAll.geofence.db", db):
        async with client as c:
            r = await c.post(
                "/api/geofence/event",
                json={"user_id": "not-an-objectid", "event": "exit"},
            )
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_unknown_user_returns_404(client):
    db, _ = _build_db(None)
    with patch("app.routes.MessageAll.geofence.db", db):
        async with client as c:
            r = await c.post(
                "/api/geofence/event",
                json={"user_id": str(ObjectId()), "event": "exit"},
            )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_invalid_event_value_is_rejected(client):
    """Pydantic enforces event ∈ {exit, enter} → 422 (validation error)."""
    db, _ = _build_db(_user_doc())
    with patch("app.routes.MessageAll.geofence.db", db):
        async with client as c:
            r = await c.post(
                "/api/geofence/event",
                json={"user_id": str(ObjectId()), "event": "leaving"},
            )
    assert r.status_code == 422
