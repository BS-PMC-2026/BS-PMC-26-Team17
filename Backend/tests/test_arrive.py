"""Unit + integration tests for POST /shelters/{id}/arrive and the
arrival-related behavior changes elsewhere (release skips arrived,
sweeper decays arrived rows by actualOccupancy).
"""
import pytest
from datetime import datetime, timedelta, timezone
from bson import ObjectId
from httpx import AsyncClient, ASGITransport
from unittest.mock import patch, MagicMock, AsyncMock

from app.main import app
from app.core import reservations as sweeper_mod
from app.core.reservations import sweep_once


SHELTER_OID = ObjectId("65a1b2c3d4e5f6a7b8c9d0e1")
SHELTER_ID  = str(SHELTER_OID)


def _shelter_doc(**overrides):
    base = {
        "_id":             SHELTER_OID,
        "name":            "Test", "lat": 31.0, "lng": 34.0,
        "capacity":        10,
        "reservedPlaces":  0,
        "actualOccupancy": 0,
        "isFull":          False,
    }
    base.update(overrides)
    return base


# ── Unit tests for /arrive ───────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_arrive_returns_400_on_invalid_shelter_id(async_client):
    res = await async_client.post(
        "/shelters/not-an-objectid/arrive",
        json={"user_id": "u1", "alert_id": "a1"},
    )
    assert res.status_code == 400


@pytest.mark.asyncio
async def test_arrive_returns_404_when_shelter_missing(async_client):
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
            f"/shelters/{SHELTER_ID}/arrive",
            json={"user_id": "u1", "alert_id": "a1"},
        )
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_arrive_is_a_noop_when_no_active_reservation(async_client):
    """Arrival ping without a prior reservation is a 200 no-op."""
    shelter_coll = MagicMock()
    shelter_coll.find_one = AsyncMock(return_value=_shelter_doc())
    shelter_coll.update_one = AsyncMock(return_value=MagicMock(modified_count=1))
    reservation_coll = MagicMock()
    reservation_coll.find_one_and_update = AsyncMock(return_value=None)
    db = MagicMock()
    db.__getitem__.side_effect = lambda n: {
        "ShelterTest": shelter_coll, "ShelterReservation": reservation_coll,
    }[n]

    with patch("app.routes.shelters.db", db):
        res = await async_client.post(
            f"/shelters/{SHELTER_ID}/arrive",
            json={"user_id": "u1", "alert_id": "a1"},
        )

    assert res.status_code == 200
    assert res.json()["promoted"] is False
    # No counter $inc was issued
    for call in shelter_coll.update_one.await_args_list:
        update = call.args[1]
        assert "$inc" not in update


@pytest.mark.asyncio
async def test_arrive_moves_group_from_reserved_to_actual(async_client):
    existing = {
        "_id": ObjectId(), "userId": "u1", "shelterId": SHELTER_ID, "alertId": "a1",
        "groupSize": 3, "rolledBack": False, "arrived": False,
    }
    shelter_pre  = _shelter_doc(reservedPlaces=3, actualOccupancy=0)
    shelter_post = _shelter_doc(reservedPlaces=0, actualOccupancy=3)
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
            f"/shelters/{SHELTER_ID}/arrive",
            json={"user_id": "u1", "alert_id": "a1"},
        )

    assert res.status_code == 200
    body = res.json()
    assert body["promoted"] is True
    assert body["reservedPlaces"] == 0
    assert body["actualOccupancy"] == 3

    # Single $inc with both counters moving in opposite directions
    shelter_coll.update_one.assert_any_await(
        {"_id": SHELTER_OID},
        {"$inc": {"reservedPlaces": -3, "actualOccupancy": +3}},
    )

    # The reservation row was flipped to arrived (and expiresAt extended)
    args = reservation_coll.find_one_and_update.await_args.args
    assert args[0]["arrived"] == {"$ne": True}
    assert args[1]["$set"]["arrived"] is True
    assert "arrivedAt" in args[1]["$set"]
    assert "expiresAt" in args[1]["$set"]


# ── Integration: arrive + release + sweeper interplay ────────────────────────

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
    """Apply the {$ne: ...} subset of Mongo's filter operators."""
    for k, v in query.items():
        if isinstance(v, dict):
            if "$ne" in v and row.get(k) == v["$ne"]:
                return False
            if "$lt" in v and not (row.get(k) is not None and row.get(k) < v["$lt"]):
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
            if _matches_filter(r, query): return dict(r)
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
    def find(self, query):
        matching = [r for r in self.rows if _matches_filter(r, query)]
        class _AsyncCursor:
            def __init__(self, items): self._iter = iter(items)
            def __aiter__(self): return self
            async def __anext__(self):
                try: return next(self._iter)
                except StopIteration: raise StopAsyncIteration
        return _AsyncCursor(matching)


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
async def test_reserve_then_arrive_moves_count_between_columns(fake_db):
    db, sid, shelters, reservations = fake_db
    sid_str = str(sid)
    with patch("app.routes.shelters.db", db):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            await client.post(
                f"/shelters/{sid_str}/reserve",
                json={"user_id": "u1", "alert_id": "a1", "group_size": 4},
            )
            assert shelters.docs[sid]["reservedPlaces"] == 4
            assert shelters.docs[sid]["actualOccupancy"] == 0

            res = await client.post(
                f"/shelters/{sid_str}/arrive",
                json={"user_id": "u1", "alert_id": "a1"},
            )

    assert res.status_code == 200
    assert res.json()["promoted"] is True
    assert shelters.docs[sid]["reservedPlaces"] == 0
    assert shelters.docs[sid]["actualOccupancy"] == 4
    assert reservations.rows[0]["arrived"] is True


@pytest.mark.asyncio
async def test_arrive_twice_only_promotes_once(fake_db):
    db, sid, shelters, _ = fake_db
    sid_str = str(sid)
    with patch("app.routes.shelters.db", db):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            await client.post(
                f"/shelters/{sid_str}/reserve",
                json={"user_id": "u1", "alert_id": "a1", "group_size": 2},
            )
            r1 = await client.post(
                f"/shelters/{sid_str}/arrive",
                json={"user_id": "u1", "alert_id": "a1"},
            )
            r2 = await client.post(
                f"/shelters/{sid_str}/arrive",
                json={"user_id": "u1", "alert_id": "a1"},
            )

    assert r1.json()["promoted"] is True
    assert r2.json()["promoted"] is False
    assert shelters.docs[sid]["actualOccupancy"] == 2  # not doubled


@pytest.mark.asyncio
async def test_release_after_arrive_is_a_noop(fake_db):
    """X-ing out of /navigate after physically arriving must NOT undo arrival."""
    db, sid, shelters, _ = fake_db
    sid_str = str(sid)
    with patch("app.routes.shelters.db", db):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            await client.post(
                f"/shelters/{sid_str}/reserve",
                json={"user_id": "u1", "alert_id": "a1", "group_size": 3},
            )
            await client.post(
                f"/shelters/{sid_str}/arrive",
                json={"user_id": "u1", "alert_id": "a1"},
            )
            release_res = await client.post(
                f"/shelters/{sid_str}/release",
                json={"user_id": "u1", "alert_id": "a1"},
            )

    assert release_res.json()["released"] is False
    # actualOccupancy held the count even though /release was called
    assert shelters.docs[sid]["actualOccupancy"] == 3
    assert shelters.docs[sid]["reservedPlaces"] == 0


# ── Sweeper: arrived row decay ───────────────────────────────────────────────

def _patch_sweeper_db(shelters, reservations):
    db = MagicMock()
    db.__getitem__.side_effect = lambda n: {
        "ShelterTest": shelters, "ShelterReservation": reservations,
    }[n]
    return patch.object(sweeper_mod, "db", db)


@pytest.mark.asyncio
async def test_sweeper_decays_arrived_row_by_actualOccupancy():
    sid = ObjectId()
    shelters = FakeShelterCollection([{
        "_id": sid, "capacity": 10,
        "reservedPlaces": 0, "actualOccupancy": 4, "isFull": False,
    }])
    expired_arrived = {
        "_id": ObjectId(), "shelterId": str(sid),
        "userId": "u1", "alertId": "a1", "alertKind": "siren",
        "groupSize": 4, "arrived": True, "rolledBack": False,
        "createdAt": datetime.now(timezone.utc) - timedelta(hours=1),
        "arrivedAt": datetime.now(timezone.utc) - timedelta(minutes=40),
        "expiresAt": datetime.now(timezone.utc) - timedelta(minutes=10),
    }
    reservations = FakeReservationCollection()
    reservations.rows = [expired_arrived]

    with _patch_sweeper_db(shelters, reservations):
        rolled = await sweep_once()

    assert rolled == 1
    # actualOccupancy decremented, NOT reservedPlaces (which was 0 anyway)
    assert shelters.docs[sid]["actualOccupancy"] == 0
    assert shelters.docs[sid]["reservedPlaces"] == 0
    assert reservations.rows[0]["rolledBack"] is True


@pytest.mark.asyncio
async def test_sweeper_decays_arrived_and_reserved_in_one_pass():
    sid = ObjectId()
    shelters = FakeShelterCollection([{
        "_id": sid, "capacity": 100,
        "reservedPlaces": 5, "actualOccupancy": 3, "isFull": False,
    }])
    expired_reserved = {
        "_id": ObjectId(), "shelterId": str(sid), "userId": "u1", "alertId": "a1",
        "alertKind": "siren", "groupSize": 5, "arrived": False, "rolledBack": False,
        "createdAt": datetime.now(timezone.utc) - timedelta(hours=1),
        "expiresAt": datetime.now(timezone.utc) - timedelta(minutes=5),
    }
    expired_arrived = {
        "_id": ObjectId(), "shelterId": str(sid), "userId": "u2", "alertId": "a1",
        "alertKind": "siren", "groupSize": 3, "arrived": True, "rolledBack": False,
        "createdAt": datetime.now(timezone.utc) - timedelta(hours=1),
        "arrivedAt": datetime.now(timezone.utc) - timedelta(minutes=40),
        "expiresAt": datetime.now(timezone.utc) - timedelta(minutes=10),
    }
    reservations = FakeReservationCollection()
    reservations.rows = [expired_reserved, expired_arrived]

    with _patch_sweeper_db(shelters, reservations):
        rolled = await sweep_once()

    assert rolled == 2
    assert shelters.docs[sid]["reservedPlaces"] == 0
    assert shelters.docs[sid]["actualOccupancy"] == 0
