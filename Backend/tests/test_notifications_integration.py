"""End-to-end integration tests for the closed/locked-shelter notification flow.

Walks every step through the real FastAPI app:
  1. Register an admin user
  2. Save their Expo push token via POST /auth/push-token
  3. POST a closed/locked report
  4. Verify Expo Push API was called and a NotificationLog entry was written

The Expo HTTP client is mocked at the seam (`send_expo_push`) so we don't talk
to the public Expo service. Everything else — Pydantic validation, route
plumbing, BackgroundTasks lifecycle, db queries — runs the real code.
"""
import asyncio
from datetime import datetime, timezone

import pytest
from bson import ObjectId
from httpx import AsyncClient, ASGITransport
from unittest.mock import AsyncMock, MagicMock, patch

from app.main import app


class FakeCollection:
    """Mongo-shaped in-memory collection. Supports the small surface the
    reports + auth routes touch in this flow."""

    def __init__(self):
        self.docs = []

    def _match(self, doc, query):
        for k, v in query.items():
            if isinstance(v, dict):
                # Tiny subset of operators we actually use:
                if "$exists" in v and "$ne" in v:
                    val = doc.get(k)
                    if val is None or val == v["$ne"]:
                        return False
                elif "$gte" in v:
                    if doc.get(k) is None or doc[k] < v["$gte"]:
                        return False
                else:
                    return False
            elif doc.get(k) != v:
                return False
        return True

    async def find_one(self, query):
        for d in self.docs:
            if self._match(d, query):
                return d
        return None

    async def insert_one(self, doc):
        doc.setdefault("_id", ObjectId())
        self.docs.append(doc)
        return MagicMock(inserted_id=doc["_id"])

    async def update_one(self, query, update, upsert=False):
        existing = await self.find_one(query)
        if existing:
            existing.update(update.get("$set", {}))
            for k in update.get("$unset", {}).keys():
                existing.pop(k, None)
            return MagicMock(matched_count=1)
        if upsert:
            new = {**query, **update.get("$set", {})}
            await self.insert_one(new)
            return MagicMock(matched_count=0)
        return MagicMock(matched_count=0)

    async def count_documents(self, query=None):
        return len(self.docs)

    def find(self, query=None):
        query = query or {}
        matched = [d for d in self.docs if self._match(d, query)]

        class _Cursor:
            def __init__(self, items):
                self._items = items
            def __aiter__(self):
                self._it = iter(self._items)
                return self
            async def __anext__(self):
                try:
                    return next(self._it)
                except StopIteration:
                    raise StopAsyncIteration
            def sort(self, *args, **kwargs):
                return self
            def limit(self, *args, **kwargs):
                return self

        return _Cursor(matched)


@pytest.fixture
def fake_db():
    users = FakeCollection()
    shelters = FakeCollection()
    reports = FakeCollection()
    resets = FakeCollection()
    notifs = FakeCollection()

    def get_coll(name):
        return {
            "User": users,
            "ShelterTest": shelters,
            "Report": reports,
            "PasswordReset": resets,
            "NotificationLog": notifs,
        }[name]

    db = MagicMock()
    db.__getitem__.side_effect = get_coll
    return db, {"users": users, "shelters": shelters, "reports": reports, "notifs": notifs}


@pytest.fixture
def patched(fake_db):
    """Patch db in every module that imports it, plus the push sender."""
    db, colls = fake_db
    push_mock = AsyncMock(return_value=True)
    with patch("app.routes.reports.db", db), \
         patch("app.routes.auth.db", db), \
         patch("app.routes.reports.send_expo_push", new=push_mock):
        yield colls, push_mock


@pytest.fixture
def client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def _seed_admin_with_token(colls, push_token="ExponentPushToken[admin1]"):
    """Insert an admin user and (separately) save a push token through the API."""
    admin_id = ObjectId()
    colls["users"].docs.append({
        "_id": admin_id,
        "email": "admin@example.com",
        "password": "admin123",
        "role": "admin",
        "expoPushToken": push_token,
    })
    return str(admin_id)


def _make_shelter(colls, *, lat=32.0853, lng=34.7818, name="Test Shelter"):
    sid = ObjectId()
    colls["shelters"].docs.append({"_id": sid, "lat": lat, "lng": lng, "name": name})
    return str(sid)


def _make_user(colls, *, email="user@example.com"):
    uid = ObjectId()
    colls["users"].docs.append({
        "_id": uid,
        "email": email,
        "password": "x",
        "role": "user",
        "telephone": "0501234567",
    })
    return str(uid)


# ── /auth/push-token endpoint ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_save_push_token_writes_to_user(client, patched):
    colls, _ = patched
    uid = ObjectId()
    colls["users"].docs.append({"_id": uid, "email": "u@x.com", "role": "user"})

    async with client as c:
        r = await c.post(
            "/auth/push-token",
            json={"user_id": str(uid), "push_token": "ExponentPushToken[xyz]"},
        )

    assert r.status_code == 200
    user = colls["users"].docs[0]
    assert user["expoPushToken"] == "ExponentPushToken[xyz]"


@pytest.mark.asyncio
async def test_clear_push_token_removes_field(client, patched):
    colls, _ = patched
    uid = ObjectId()
    colls["users"].docs.append({
        "_id": uid, "email": "u@x.com", "role": "user",
        "expoPushToken": "ExponentPushToken[xyz]",
    })

    async with client as c:
        r = await c.delete(f"/auth/push-token/{str(uid)}")

    assert r.status_code == 200
    assert "expoPushToken" not in colls["users"].docs[0]


# ── Closed-shelter end-to-end ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_closed_shelter_report_pushes_to_admin(client, patched):
    colls, push_mock = patched
    admin_id = await _seed_admin_with_token(colls)
    shelter_id = _make_shelter(colls)
    user_id = _make_user(colls)

    async with client as c:
        r = await c.post("/reports", json={
            "shelterId": shelter_id,
            "userId": user_id,
            "reportCategory": "access",
            "reportType": "closed",
            "description": "Door padlocked",
            "reporterLat": 32.0900,    # ~520m away — not verified, but closed still notifies
            "reporterLng": 34.7818,
            "reporterNumber": "0500000000",
            "callbackNumber": "",
        })

    # The report itself succeeds…
    assert r.status_code == 200

    # …and the background task fires the push. BackgroundTasks complete
    # before the response is returned to httpx, so we can assert immediately.
    # Give the event loop a tick in case the task is queued
    await asyncio.sleep(0)

    push_mock.assert_awaited_once()
    sent_tokens, title, body, data = push_mock.call_args.args
    assert sent_tokens == ["ExponentPushToken[admin1]"]
    assert title == "Closed shelter reported"
    assert data["type"] == "closed"
    assert data["shelterId"] == shelter_id

    # NotificationLog records the send
    assert len(colls["notifs"].docs) == 1
    log = colls["notifs"].docs[0]
    assert log["type"] == "closed"
    assert log["shelterId"] == shelter_id


# ── Locked-shelter end-to-end (verified) ─────────────────────────────────────

@pytest.mark.asyncio
async def test_verified_locked_report_pushes_to_admin(client, patched):
    colls, push_mock = patched
    await _seed_admin_with_token(colls)
    shelter_id = _make_shelter(colls)
    user_id = _make_user(colls)

    async with client as c:
        r = await c.post("/reports", json={
            "shelterId": shelter_id,
            "userId": user_id,
            "reportCategory": "access",
            "reportType": "locked",
            "description": "Padlock visible",
            "reporterLat": 32.0853,  # exact shelter location → verified
            "reporterLng": 34.7818,
            "reporterNumber": "0500000000",
            "callbackNumber": "",
        })

    assert r.status_code == 200
    await asyncio.sleep(0)

    push_mock.assert_awaited_once()
    _tokens, title, _body, data = push_mock.call_args.args
    assert title == "Locked shelter reported"
    assert data["type"] == "locked"


@pytest.mark.asyncio
async def test_unverified_locked_report_no_push(client, patched):
    """The route rejects the report at the gate, so the task never runs."""
    colls, push_mock = patched
    await _seed_admin_with_token(colls)
    shelter_id = _make_shelter(colls)
    user_id = _make_user(colls)

    async with client as c:
        r = await c.post("/reports", json={
            "shelterId": shelter_id,
            "userId": user_id,
            "reportCategory": "access",
            "reportType": "locked",
            "description": "",
            "reporterLat": 32.0900,  # too far
            "reporterLng": 34.7818,
            "reporterNumber": "0500000000",
            "callbackNumber": "",
        })

    assert r.status_code == 400
    push_mock.assert_not_called()


# ── Coalescing across types ──────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_two_closed_reports_in_window_send_one_push(client, patched):
    colls, push_mock = patched
    await _seed_admin_with_token(colls)
    shelter_id = _make_shelter(colls)
    user_id = _make_user(colls)

    body = {
        "shelterId": shelter_id,
        "userId": user_id,
        "reportCategory": "access",
        "reportType": "closed",
        "description": "",
        "reporterLat": 32.09,
        "reporterLng": 34.78,
        "reporterNumber": "0500000000",
        "callbackNumber": "",
    }
    async with client as c:
        await c.post("/reports", json=body)
        await asyncio.sleep(0)
        await c.post("/reports", json=body)
        await asyncio.sleep(0)

    assert push_mock.await_count == 1
    assert len(colls["notifs"].docs) == 1


@pytest.mark.asyncio
async def test_closed_then_locked_for_same_shelter_both_send(client, patched):
    """Closed and Locked are separate event types — both can notify in the
    same window for the same shelter."""
    colls, push_mock = patched
    await _seed_admin_with_token(colls)
    shelter_id = _make_shelter(colls)
    user_id = _make_user(colls)

    base = {
        "shelterId": shelter_id,
        "userId": user_id,
        "reportCategory": "access",
        "description": "",
        "reporterLat": 32.0853,
        "reporterLng": 34.7818,  # at the shelter — required for locked verification
        "reporterNumber": "0500000000",
        "callbackNumber": "",
    }
    async with client as c:
        await c.post("/reports", json={**base, "reportType": "closed"})
        await asyncio.sleep(0)
        await c.post("/reports", json={**base, "reportType": "locked"})
        await asyncio.sleep(0)

    assert push_mock.await_count == 2
    types_sent = [call.args[3]["type"] for call in push_mock.await_args_list]
    assert set(types_sent) == {"closed", "locked"}


@pytest.mark.asyncio
async def test_no_admins_means_no_push(client, patched):
    """No admin tokens registered → background task runs but sends nothing."""
    colls, push_mock = patched
    # No admin seeded — only a regular user
    shelter_id = _make_shelter(colls)
    user_id = _make_user(colls)

    async with client as c:
        r = await c.post("/reports", json={
            "shelterId": shelter_id,
            "userId": user_id,
            "reportCategory": "access",
            "reportType": "closed",
            "description": "",
            "reporterLat": 32.09,
            "reporterLng": 34.78,
            "reporterNumber": "0500000000",
            "callbackNumber": "",
        })

    assert r.status_code == 200
    await asyncio.sleep(0)
    push_mock.assert_not_called()
    assert len(colls["notifs"].docs) == 0
