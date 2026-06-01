"""Integration tests for POST /shelters/{id}/reserve.

Unlike test_reservations.py (which mocks each call), these run multiple
requests against the same in-memory fake collections so we can prove
end-to-end behavior: same (user, shelter, alert) upserts the same row,
different (alert) inserts a new one, isFull derivation matches the math,
and so on.
"""
import pytest
from bson import ObjectId
from httpx import AsyncClient, ASGITransport
from unittest.mock import MagicMock, patch

from app.main import app


class FakeShelterCollection:
    """Minimal in-memory ShelterTest stand-in supporting find_one + update_one."""

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
            for k, v in update["$set"].items():
                doc[k] = v
        if "$inc" in update:
            for k, v in update["$inc"].items():
                doc[k] = int(doc.get(k, 0) or 0) + v
        return MagicMock(matched_count=1, modified_count=1)


class FakeReservationCollection:
    """Minimal in-memory ShelterReservation stand-in."""

    def __init__(self):
        self.rows = []

    async def find_one(self, query):
        for r in self.rows:
            if all(r.get(k) == v for k, v in query.items()):
                return dict(r)
        return None

    async def insert_one(self, doc):
        doc = dict(doc)
        doc["_id"] = ObjectId()
        self.rows.append(doc)
        return MagicMock(inserted_id=doc["_id"])

    async def update_one(self, query, update):
        for r in self.rows:
            if all(r.get(k) == v for k, v in query.items()):
                if "$set" in update:
                    for k, v in update["$set"].items():
                        r[k] = v
                return MagicMock(matched_count=1, modified_count=1)
        return MagicMock(matched_count=0, modified_count=0)


@pytest.fixture
def fake_db():
    shelter_oid = ObjectId()
    shelters = FakeShelterCollection([{
        "_id": shelter_oid,
        "name": "Test", "lat": 31.0, "lng": 34.0,
        "capacity": 10, "reservedPlaces": 0, "actualOccupancy": 0, "isFull": False,
    }])
    reservations = FakeReservationCollection()
    db = MagicMock()
    db.__getitem__.side_effect = lambda n: {
        "ShelterTest": shelters, "ShelterReservation": reservations,
    }[n]
    return db, shelter_oid, shelters, reservations


async def _reserve(client, sid, **body):
    body.setdefault("alert_kind", "siren")
    return await client.post(f"/shelters/{sid}/reserve", json=body)


@pytest.mark.asyncio
async def test_same_user_same_alert_upserts_one_row(fake_db):
    db, sid, shelters, reservations = fake_db
    sid_str = str(sid)
    with patch("app.routes.shelters.db", db):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r1 = await _reserve(client, sid_str, user_id="u1", alert_id="a1", group_size=1)
            r2 = await _reserve(client, sid_str, user_id="u1", alert_id="a1", group_size=4)
            r3 = await _reserve(client, sid_str, user_id="u1", alert_id="a1", group_size=2)

    assert [r.status_code for r in (r1, r2, r3)] == [200, 200, 200]
    # The reservation_id stays the same across the three calls (same row)
    assert r1.json()["reservation_id"] == r2.json()["reservation_id"] == r3.json()["reservation_id"]
    # And we never accumulated more than one row
    assert len(reservations.rows) == 1
    # Final reservedPlaces matches the last requested groupSize, not the sum
    assert shelters.docs[sid]["reservedPlaces"] == 2
    assert r3.json()["reservedPlaces"] == 2


@pytest.mark.asyncio
async def test_different_alerts_stack_separate_rows(fake_db):
    db, sid, shelters, reservations = fake_db
    sid_str = str(sid)
    with patch("app.routes.shelters.db", db):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            await _reserve(client, sid_str, user_id="u1", alert_id="a1", group_size=2)
            await _reserve(client, sid_str, user_id="u1", alert_id="a2", group_size=3)

    assert len(reservations.rows) == 2
    assert shelters.docs[sid]["reservedPlaces"] == 5  # 2 + 3


@pytest.mark.asyncio
async def test_different_users_stack_separate_rows(fake_db):
    db, sid, shelters, reservations = fake_db
    sid_str = str(sid)
    with patch("app.routes.shelters.db", db):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            await _reserve(client, sid_str, user_id="u1", alert_id="a1", group_size=1)
            await _reserve(client, sid_str, user_id="u2", alert_id="a1", group_size=4)

    assert len(reservations.rows) == 2
    assert shelters.docs[sid]["reservedPlaces"] == 5


@pytest.mark.asyncio
async def test_isFull_flips_true_then_false_via_upsert(fake_db):
    db, sid, shelters, reservations = fake_db
    sid_str = str(sid)
    with patch("app.routes.shelters.db", db):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            # Pre-fill: 5 actual + 5 reserved = capacity 10 → isFull true
            r1 = await _reserve(client, sid_str, user_id="u1", alert_id="a1", group_size=10)
            assert r1.json()["isFull"] is True
            assert shelters.docs[sid]["isFull"] is True

            # Drop to 3 → isFull flips back to false
            r2 = await _reserve(client, sid_str, user_id="u1", alert_id="a1", group_size=3)
            assert r2.json()["isFull"] is False
            assert shelters.docs[sid]["isFull"] is False
