"""Tests for the admin broadcast routes.

POST /api/admin/broadcast — admin authorization, storage in Broadcast
collection, batched Expo push.
GET  /api/broadcasts — returns broadcasts strictly after `after`.

db and send_expo_push are mocked. We never hit MongoDB or the Expo
service; everything else (route handling, validation) runs for real.
"""
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from bson import ObjectId
from httpx import AsyncClient, ASGITransport

from app.main import app


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


def _admin_doc():
    return {
        "_id": ObjectId(),
        "email": "admin@example.com",
        "role": "admin",
        "firstName": "Admin",
        "lastName": "One",
    }


def _user_doc():
    return {
        "_id": ObjectId(),
        "email": "u@example.com",
        "role": "user",
    }


@pytest.fixture
def client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


# ── POST /api/admin/broadcast ──────────────────────────────────────────────

@pytest.mark.asyncio
async def test_admin_broadcast_persists_and_pushes(client):
    admin = _admin_doc()
    inserted_id = ObjectId()

    user_coll = MagicMock()
    user_coll.find_one = AsyncMock(return_value=admin)
    # find() returns two users with tokens + one without (filtered server-side
    # via the $exists/$ne query — we just simulate the result)
    user_coll.find = MagicMock(return_value=_async_iter([
        {"expoPushToken": "ExponentPushToken[a]"},
        {"expoPushToken": "ExponentPushToken[b]"},
    ]))

    broadcast_coll = MagicMock()
    broadcast_coll.insert_one = AsyncMock(
        return_value=MagicMock(inserted_id=inserted_id)
    )

    db = MagicMock()
    db.__getitem__.side_effect = lambda name: {
        "User": user_coll, "Broadcast": broadcast_coll,
    }[name]

    push_mock = AsyncMock(return_value=True)

    with patch("app.routes.MessageAll.broadcast.db", db), \
         patch("app.routes.MessageAll.broadcast.send_expo_push", new=push_mock):
        async with client as c:
            r = await c.post(
                "/api/admin/broadcast",
                json={
                    "admin_id": str(admin["_id"]),
                    "title": "Drill at 10:00",
                    "body": "Practice run, no real alarm.",
                },
            )

    assert r.status_code == 200
    body = r.json()
    assert body["broadcast_id"] == str(inserted_id)
    assert body["tokenCount"] == 2
    assert body["pushedCount"] == 2

    # Stored to MongoDB with the right fields
    broadcast_coll.insert_one.assert_awaited_once()
    stored = broadcast_coll.insert_one.call_args.args[0]
    assert stored["title"] == "Drill at 10:00"
    assert stored["body"] == "Practice run, no real alarm."
    assert stored["senderId"] == str(admin["_id"])
    assert "sentAt" in stored

    # Push fired with both tokens in one batch (under the 100-cap)
    push_mock.assert_awaited_once()
    p_args = push_mock.call_args.args
    assert sorted(p_args[0]) == ["ExponentPushToken[a]", "ExponentPushToken[b]"]


@pytest.mark.asyncio
async def test_non_admin_gets_403(client):
    user = _user_doc()
    user_coll = MagicMock()
    user_coll.find_one = AsyncMock(return_value=user)
    db = MagicMock()
    db.__getitem__.side_effect = lambda name: {"User": user_coll}[name]

    with patch("app.routes.MessageAll.broadcast.db", db), \
         patch("app.routes.MessageAll.broadcast.send_expo_push", new=AsyncMock()):
        async with client as c:
            r = await c.post(
                "/api/admin/broadcast",
                json={"admin_id": str(user["_id"]), "title": "t", "body": "b"},
            )

    assert r.status_code == 403


@pytest.mark.asyncio
async def test_invalid_admin_id_returns_400(client):
    db = MagicMock()
    with patch("app.routes.MessageAll.broadcast.db", db):
        async with client as c:
            r = await c.post(
                "/api/admin/broadcast",
                json={"admin_id": "not-an-objectid", "title": "t", "body": "b"},
            )
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_unknown_admin_returns_404(client):
    user_coll = MagicMock()
    user_coll.find_one = AsyncMock(return_value=None)
    db = MagicMock()
    db.__getitem__.side_effect = lambda name: {"User": user_coll}[name]

    with patch("app.routes.MessageAll.broadcast.db", db):
        async with client as c:
            r = await c.post(
                "/api/admin/broadcast",
                json={"admin_id": str(ObjectId()), "title": "t", "body": "b"},
            )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_broadcast_with_no_tokens_still_stores(client):
    """If no user has a push token, the broadcast is still persisted —
    polling clients will pick it up on their next tick."""
    admin = _admin_doc()
    inserted_id = ObjectId()

    user_coll = MagicMock()
    user_coll.find_one = AsyncMock(return_value=admin)
    user_coll.find = MagicMock(return_value=_async_iter([]))

    broadcast_coll = MagicMock()
    broadcast_coll.insert_one = AsyncMock(
        return_value=MagicMock(inserted_id=inserted_id)
    )

    db = MagicMock()
    db.__getitem__.side_effect = lambda name: {
        "User": user_coll, "Broadcast": broadcast_coll,
    }[name]

    push_mock = AsyncMock(return_value=True)

    with patch("app.routes.MessageAll.broadcast.db", db), \
         patch("app.routes.MessageAll.broadcast.send_expo_push", new=push_mock):
        async with client as c:
            r = await c.post(
                "/api/admin/broadcast",
                json={
                    "admin_id": str(admin["_id"]),
                    "title": "Test",
                    "body": "Test body",
                },
            )

    assert r.status_code == 200
    body = r.json()
    assert body["tokenCount"] == 0
    assert body["pushedCount"] == 0
    broadcast_coll.insert_one.assert_awaited_once()
    push_mock.assert_not_awaited()


# ── GET /api/broadcasts ────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_broadcasts_filters_by_after(client):
    """The route should only ask Mongo for documents with sentAt > cutoff
    AND should serialize timestamps as ISO strings."""
    now = datetime.now(timezone.utc)
    older = now - timedelta(hours=2)
    newer = now + timedelta(seconds=5)

    captured_query: dict = {}

    def find(query=None):
        nonlocal captured_query
        captured_query = query or {}

        class _Cursor:
            def __init__(self, items):
                self._items = items
            def sort(self, *_a, **_kw):
                return self
            def limit(self, *_a, **_kw):
                return self
            def __aiter__(self):
                self._it = iter(self._items)
                return self
            async def __anext__(self):
                try:
                    return next(self._it)
                except StopIteration:
                    raise StopAsyncIteration

        # Only return broadcasts that would actually pass the filter
        all_items = [
            {"_id": ObjectId(), "title": "old", "body": ".", "senderName": "A",
             "sentAt": older},
            {"_id": ObjectId(), "title": "new", "body": ".", "senderName": "A",
             "sentAt": newer},
        ]
        cutoff = captured_query.get("sentAt", {}).get("$gt")
        passed = [d for d in all_items if cutoff is None or d["sentAt"] > cutoff]
        return _Cursor(passed)

    broadcast_coll = MagicMock()
    broadcast_coll.find = MagicMock(side_effect=find)
    db = MagicMock()
    db.__getitem__.side_effect = lambda name: {"Broadcast": broadcast_coll}[name]

    with patch("app.routes.MessageAll.broadcast.db", db):
        async with client as c:
            r = await c.get("/api/broadcasts", params={"after": now.isoformat()})

    assert r.status_code == 200
    items = r.json()["items"]
    titles = [i["title"] for i in items]
    assert titles == ["new"]
    assert "sentAt" in captured_query
    assert isinstance(items[0]["sentAt"], str)  # ISO-serialised


@pytest.mark.asyncio
async def test_list_broadcasts_rejects_bad_timestamp(client):
    db = MagicMock()
    with patch("app.routes.MessageAll.broadcast.db", db):
        async with client as c:
            r = await c.get("/api/broadcasts?after=not-a-date")
    assert r.status_code == 400
