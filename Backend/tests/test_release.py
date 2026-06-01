"""Unit + integration tests for POST /shelters/{id}/release.

Released reservations decrement the shelter's reservedPlaces immediately
(instead of waiting for the 30-min TTL sweeper), letting the count stay
honest when a user cancels their navigation.
"""
import pytest
from bson import ObjectId
from httpx import AsyncClient, ASGITransport
from unittest.mock import patch, MagicMock, AsyncMock

from app.main import app


SHELTER_OID = ObjectId("65a1b2c3d4e5f6a7b8c9d0e1")
SHELTER_ID  = str(SHELTER_OID)


def _shelter_doc(**overrides):
    base = {
        "_id":             SHELTER_OID,
        "name":            "Test",
        "lat":             31.0, "lng": 34.0,
        "capacity":        10,
        "reservedPlaces":  3,
        "actualOccupancy": 0,
        "isFull":          False,
    }
    base.update(overrides)
    return base


# ── Unit tests (mocked db) ───────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_release_returns_400_on_invalid_shelter_id(async_client):
    res = await async_client.post(
        "/shelters/not-an-objectid/release",
        json={"user_id": "u1", "alert_id": "a1"},
    )
    assert res.status_code == 400


@pytest.mark.asyncio
async def test_release_returns_404_when_shelter_missing(async_client):
    shelter_coll = MagicMock()
    shelter_coll.find_one = AsyncMock(return_value=None)
    reservation_coll = MagicMock()
    reservation_coll.find_one_and_update = AsyncMock(return_value=None)
    db = MagicMock()
    db.__getitem__.side_effect = lambda n: {
        "ShelterTest": shelter_coll, "ShelterReservation": reservation_coll,
    }[n]
    with patch("app.routes.shelters.db", db):
        res = await async_client.post(
            f"/shelters/{SHELTER_ID}/release",
            json={"user_id": "u1", "alert_id": "a1"},
        )
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_release_is_a_noop_when_no_active_reservation(async_client):
    """Backing out without ever reserving (or after TTL fired) is a 200 no-op."""
    shelter_coll = MagicMock()
    shelter_coll.find_one = AsyncMock(return_value=_shelter_doc(reservedPlaces=0))
    shelter_coll.update_one = AsyncMock(return_value=MagicMock(modified_count=1))

    reservation_coll = MagicMock()
    reservation_coll.find_one_and_update = AsyncMock(return_value=None)

    db = MagicMock()
    db.__getitem__.side_effect = lambda n: {
        "ShelterTest": shelter_coll, "ShelterReservation": reservation_coll,
    }[n]

    with patch("app.routes.shelters.db", db):
        res = await async_client.post(
            f"/shelters/{SHELTER_ID}/release",
            json={"user_id": "u1", "alert_id": "a1"},
        )

    assert res.status_code == 200
    body = res.json()
    assert body["released"] is False
    assert body["reservedPlaces"] == 0
    # No $inc was issued (no row to decrement against)
    for call in shelter_coll.update_one.await_args_list:
        update = call.args[1]
        assert "$inc" not in update


@pytest.mark.asyncio
async def test_release_decrements_reserved_places_by_group_size(async_client):
    existing = {
        "_id": ObjectId("65a1b2c3d4e5f6a7b8c9d0e3"),
        "userId": "u1", "shelterId": SHELTER_ID, "alertId": "a1",
        "groupSize": 4, "rolledBack": False,
    }
    shelter_pre  = _shelter_doc(reservedPlaces=4)
    shelter_post = _shelter_doc(reservedPlaces=0)
    shelter_coll = MagicMock()
    shelter_coll.find_one = AsyncMock(side_effect=[shelter_pre, shelter_post])
    shelter_coll.update_one = AsyncMock(return_value=MagicMock(modified_count=1))

    reservation_coll = MagicMock()
    reservation_coll.find_one_and_update = AsyncMock(return_value=existing)

    db = MagicMock()
    db.__getitem__.side_effect = lambda n: {
        "ShelterTest": shelter_coll, "ShelterReservation": reservation_coll,
    }[n]

    with patch("app.routes.shelters.db", db):
        res = await async_client.post(
            f"/shelters/{SHELTER_ID}/release",
            json={"user_id": "u1", "alert_id": "a1"},
        )

    assert res.status_code == 200
    body = res.json()
    assert body["released"] is True
    assert body["reservedPlaces"] == 0
    shelter_coll.update_one.assert_any_await(
        {"_id": SHELTER_OID},
        {"$inc": {"reservedPlaces": -4}},
    )
    # The reservation was marked rolledBack via the atomic claim
    reservation_coll.find_one_and_update.assert_awaited_once()
    args = reservation_coll.find_one_and_update.await_args.args
    assert args[0]["rolledBack"] is False
    assert args[1]["$set"]["rolledBack"] is True


@pytest.mark.asyncio
async def test_release_clears_isFull_when_room_opens_up(async_client):
    existing = {
        "_id": ObjectId(), "userId": "u1", "shelterId": SHELTER_ID, "alertId": "a1",
        "groupSize": 8, "rolledBack": False,
    }
    shelter_pre  = _shelter_doc(reservedPlaces=8, actualOccupancy=2, isFull=True)
    shelter_post = _shelter_doc(reservedPlaces=0, actualOccupancy=2, isFull=True)
    shelter_coll = MagicMock()
    shelter_coll.find_one = AsyncMock(side_effect=[shelter_pre, shelter_post])
    shelter_coll.update_one = AsyncMock(return_value=MagicMock(modified_count=1))

    reservation_coll = MagicMock()
    reservation_coll.find_one_and_update = AsyncMock(return_value=existing)

    db = MagicMock()
    db.__getitem__.side_effect = lambda n: {
        "ShelterTest": shelter_coll, "ShelterReservation": reservation_coll,
    }[n]

    with patch("app.routes.shelters.db", db):
        res = await async_client.post(
            f"/shelters/{SHELTER_ID}/release",
            json={"user_id": "u1", "alert_id": "a1"},
        )

    assert res.status_code == 200
    assert res.json()["isFull"] is False
    shelter_coll.update_one.assert_any_await(
        {"_id": SHELTER_OID},
        {"$set": {"isFull": False}},
    )


# ── Integration test (in-memory fake collections) ────────────────────────────

class FakeShelterCollection:
    def __init__(self, shelters):
        self.docs = {s["_id"]: dict(s) for s in shelters}
    async def find_one(self, query):
        oid = query.get("_id")
        return dict(self.docs[oid]) if oid in self.docs else None
    async def update_one(self, query, update):
        oid = query.get("_id")
        if oid not in self.docs:
            return MagicMock(matched_count=0, modified_count=0)
        doc = self.docs[oid]
        if "$set" in update:
            for k, v in update["$set"].items(): doc[k] = v
        if "$inc" in update:
            for k, v in update["$inc"].items():
                doc[k] = int(doc.get(k, 0) or 0) + v
        return MagicMock(matched_count=1, modified_count=1)


def _matches_filter(row, query):
    """Apply the {$ne: ...} operator subset that release/arrive use."""
    for k, v in query.items():
        if isinstance(v, dict):
            if "$ne" in v and row.get(k) == v["$ne"]:
                return False
        else:
            if row.get(k) != v:
                return False
    return True


class FakeReservationCollection:
    def __init__(self):
        self.rows = []
    async def find_one(self, query):
        for r in self.rows:
            if _matches_filter(r, query):
                return dict(r)
        return None
    async def insert_one(self, doc):
        doc = dict(doc); doc["_id"] = ObjectId()
        self.rows.append(doc)
        return MagicMock(inserted_id=doc["_id"])
    async def update_one(self, query, update):
        for r in self.rows:
            if _matches_filter(r, query):
                if "$set" in update:
                    for k, v in update["$set"].items(): r[k] = v
                return MagicMock(matched_count=1, modified_count=1)
        return MagicMock(matched_count=0, modified_count=0)
    async def find_one_and_update(self, query, update):
        for r in self.rows:
            if _matches_filter(r, query):
                before = dict(r)
                if "$set" in update:
                    for k, v in update["$set"].items(): r[k] = v
                return before
        return None


@pytest.fixture
def fake_db():
    shelter_oid = ObjectId()
    shelters = FakeShelterCollection([{
        "_id": shelter_oid, "name": "Test", "lat": 31.0, "lng": 34.0,
        "capacity": 10, "reservedPlaces": 0, "actualOccupancy": 0, "isFull": False,
    }])
    reservations = FakeReservationCollection()
    db = MagicMock()
    db.__getitem__.side_effect = lambda n: {
        "ShelterTest": shelters, "ShelterReservation": reservations,
    }[n]
    return db, shelter_oid, shelters, reservations


@pytest.mark.asyncio
async def test_reserve_then_release_returns_to_original_state(fake_db):
    db, sid, shelters, reservations = fake_db
    sid_str = str(sid)
    with patch("app.routes.shelters.db", db):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            # Reserve 5
            await client.post(
                f"/shelters/{sid_str}/reserve",
                json={"user_id": "u1", "alert_id": "a1", "group_size": 5},
            )
            assert shelters.docs[sid]["reservedPlaces"] == 5

            # Release
            res = await client.post(
                f"/shelters/{sid_str}/release",
                json={"user_id": "u1", "alert_id": "a1"},
            )

    assert res.status_code == 200
    assert res.json()["released"] is True
    assert shelters.docs[sid]["reservedPlaces"] == 0
    # The reservation row is marked rolledBack
    assert reservations.rows[0]["rolledBack"] is True


@pytest.mark.asyncio
async def test_release_twice_only_decrements_once(fake_db):
    db, sid, shelters, _ = fake_db
    sid_str = str(sid)
    with patch("app.routes.shelters.db", db):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            await client.post(
                f"/shelters/{sid_str}/reserve",
                json={"user_id": "u1", "alert_id": "a1", "group_size": 3},
            )
            r1 = await client.post(
                f"/shelters/{sid_str}/release",
                json={"user_id": "u1", "alert_id": "a1"},
            )
            r2 = await client.post(
                f"/shelters/{sid_str}/release",
                json={"user_id": "u1", "alert_id": "a1"},
            )

    assert r1.json()["released"] is True
    assert r2.json()["released"] is False
    assert shelters.docs[sid]["reservedPlaces"] == 0


@pytest.mark.asyncio
async def test_release_after_reserve_then_re_reserve_creates_new_row(fake_db):
    """User cancels → comes back → fresh reservation, not a revival of the old one."""
    db, sid, shelters, reservations = fake_db
    sid_str = str(sid)
    with patch("app.routes.shelters.db", db):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            await client.post(
                f"/shelters/{sid_str}/reserve",
                json={"user_id": "u1", "alert_id": "a1", "group_size": 2},
            )
            await client.post(
                f"/shelters/{sid_str}/release",
                json={"user_id": "u1", "alert_id": "a1"},
            )
            await client.post(
                f"/shelters/{sid_str}/reserve",
                json={"user_id": "u1", "alert_id": "a1", "group_size": 4},
            )

    assert len(reservations.rows) == 2  # old (rolledBack) + new active
    active = [r for r in reservations.rows if not r["rolledBack"]]
    rolled = [r for r in reservations.rows if r["rolledBack"]]
    assert len(active) == 1 and active[0]["groupSize"] == 4
    assert len(rolled) == 1 and rolled[0]["groupSize"] == 2
    assert shelters.docs[sid]["reservedPlaces"] == 4
