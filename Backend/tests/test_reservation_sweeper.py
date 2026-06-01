"""Tests for the reservation TTL sweeper (app/core/reservations.py).

The sweeper is what makes the time-based decay actually happen: every
~60s it finds expired ShelterReservation rows, $inc decrements
ShelterTest.reservedPlaces by the right amount, and marks the row
rolledBack=true so it never gets counted twice.
"""
import pytest
from datetime import datetime, timedelta, timezone
from bson import ObjectId
from unittest.mock import MagicMock, patch

from app.core import reservations as sweeper_mod
from app.core.reservations import sweep_once


# ── Fake collections (re-shaped for sweeper queries) ─────────────────────────

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
            for k, v in update["$set"].items():
                doc[k] = v
        if "$inc" in update:
            for k, v in update["$inc"].items():
                doc[k] = int(doc.get(k, 0) or 0) + v
        return MagicMock(matched_count=1, modified_count=1)


class FakeReservationCollection:
    def __init__(self, rows):
        self.rows = [dict(r) for r in rows]

    def find(self, query):
        # The sweeper queries: expiresAt < now AND rolledBack == false
        expires_lt = query["expiresAt"]["$lt"]
        rolled_eq  = query["rolledBack"]
        matching = [
            r for r in self.rows
            if r["expiresAt"] < expires_lt and r["rolledBack"] == rolled_eq
        ]

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

        return _AsyncCursor(matching)

    async def update_one(self, query, update):
        for r in self.rows:
            if all(r.get(k) == v for k, v in query.items()):
                if "$set" in update:
                    for k, v in update["$set"].items():
                        r[k] = v
                return MagicMock(matched_count=1, modified_count=1)
        return MagicMock(matched_count=0, modified_count=0)


def _patch_sweeper_db(shelters: FakeShelterCollection, reservations: FakeReservationCollection):
    db = MagicMock()
    db.__getitem__.side_effect = lambda n: {
        "ShelterTest": shelters, "ShelterReservation": reservations,
    }[n]
    return patch.object(sweeper_mod, "db", db)


def _expired_row(shelter_id, group_size=2, ago_minutes=5):
    return {
        "_id":        ObjectId(),
        "shelterId":  shelter_id,
        "userId":     "u1",
        "alertId":    "a1",
        "alertKind":  "siren",
        "groupSize":  group_size,
        "createdAt":  datetime.now(timezone.utc) - timedelta(minutes=ago_minutes + 30),
        "expiresAt":  datetime.now(timezone.utc) - timedelta(minutes=ago_minutes),
        "rolledBack": False,
    }


# ── Tests ────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_sweep_rolls_back_expired_and_decrements_counter():
    sid = ObjectId()
    shelters = FakeShelterCollection([{
        "_id": sid, "capacity": 10, "reservedPlaces": 4, "actualOccupancy": 0, "isFull": False,
    }])
    rows = [_expired_row(str(sid), group_size=4)]
    reservations = FakeReservationCollection(rows)

    with _patch_sweeper_db(shelters, reservations):
        rolled = await sweep_once()

    assert rolled == 1
    assert shelters.docs[sid]["reservedPlaces"] == 0
    assert reservations.rows[0]["rolledBack"] is True


@pytest.mark.asyncio
async def test_sweep_is_a_noop_when_nothing_expired():
    sid = ObjectId()
    shelters = FakeShelterCollection([{
        "_id": sid, "capacity": 10, "reservedPlaces": 3, "actualOccupancy": 0, "isFull": False,
    }])
    fresh = {
        "_id": ObjectId(), "shelterId": str(sid), "userId": "u1", "alertId": "a1",
        "alertKind": "siren", "groupSize": 3,
        "createdAt": datetime.now(timezone.utc),
        "expiresAt": datetime.now(timezone.utc) + timedelta(minutes=20),
        "rolledBack": False,
    }
    reservations = FakeReservationCollection([fresh])

    with _patch_sweeper_db(shelters, reservations):
        rolled = await sweep_once()

    assert rolled == 0
    assert shelters.docs[sid]["reservedPlaces"] == 3
    assert reservations.rows[0]["rolledBack"] is False


@pytest.mark.asyncio
async def test_sweep_skips_already_rolled_back_rows():
    sid = ObjectId()
    shelters = FakeShelterCollection([{
        "_id": sid, "capacity": 10, "reservedPlaces": 0, "actualOccupancy": 0, "isFull": False,
    }])
    expired_done = _expired_row(str(sid))
    expired_done["rolledBack"] = True
    reservations = FakeReservationCollection([expired_done])

    with _patch_sweeper_db(shelters, reservations):
        rolled = await sweep_once()

    assert rolled == 0
    assert shelters.docs[sid]["reservedPlaces"] == 0


@pytest.mark.asyncio
async def test_sweep_is_idempotent_across_two_runs():
    sid = ObjectId()
    shelters = FakeShelterCollection([{
        "_id": sid, "capacity": 10, "reservedPlaces": 2, "actualOccupancy": 0, "isFull": False,
    }])
    reservations = FakeReservationCollection([_expired_row(str(sid), group_size=2)])

    with _patch_sweeper_db(shelters, reservations):
        first  = await sweep_once()
        second = await sweep_once()

    assert first == 1
    assert second == 0
    # Counter went to zero and stayed there
    assert shelters.docs[sid]["reservedPlaces"] == 0


@pytest.mark.asyncio
async def test_sweep_clears_isFull_when_room_opens_up():
    sid = ObjectId()
    shelters = FakeShelterCollection([{
        "_id": sid, "capacity": 10, "reservedPlaces": 10, "actualOccupancy": 0, "isFull": True,
    }])
    reservations = FakeReservationCollection([_expired_row(str(sid), group_size=10)])

    with _patch_sweeper_db(shelters, reservations):
        rolled = await sweep_once()

    assert rolled == 1
    assert shelters.docs[sid]["reservedPlaces"] == 0
    assert shelters.docs[sid]["isFull"] is False


@pytest.mark.asyncio
async def test_sweep_keeps_isFull_when_actualOccupancy_alone_fills_it():
    sid = ObjectId()
    shelters = FakeShelterCollection([{
        # capacity=10, actual=10 → already full from real arrivals.
        # Rolling back the reservation must NOT clear isFull.
        "_id": sid, "capacity": 10, "reservedPlaces": 2, "actualOccupancy": 10, "isFull": True,
    }])
    reservations = FakeReservationCollection([_expired_row(str(sid), group_size=2)])

    with _patch_sweeper_db(shelters, reservations):
        await sweep_once()

    assert shelters.docs[sid]["reservedPlaces"] == 0
    assert shelters.docs[sid]["isFull"] is True


@pytest.mark.asyncio
async def test_sweep_handles_multiple_expired_in_one_pass():
    sid = ObjectId()
    shelters = FakeShelterCollection([{
        "_id": sid, "capacity": 100, "reservedPlaces": 9, "actualOccupancy": 0, "isFull": False,
    }])
    rows = [
        _expired_row(str(sid), group_size=2),
        _expired_row(str(sid), group_size=3),
        _expired_row(str(sid), group_size=4),
    ]
    reservations = FakeReservationCollection(rows)

    with _patch_sweeper_db(shelters, reservations):
        rolled = await sweep_once()

    assert rolled == 3
    assert shelters.docs[sid]["reservedPlaces"] == 0
    assert all(r["rolledBack"] for r in reservations.rows)


@pytest.mark.asyncio
async def test_sweep_with_bad_shelter_id_skips_without_crashing():
    """A reservation pointing at a malformed shelterId shouldn't kill the pass."""
    bad_row = _expired_row("not-an-objectid", group_size=3)
    reservations = FakeReservationCollection([bad_row])
    shelters = FakeShelterCollection([])

    with _patch_sweeper_db(shelters, reservations):
        rolled = await sweep_once()

    # The claim succeeded (rolledBack=True), but the $inc was skipped
    # because we couldn't parse the shelterId. Count of "fully rolled
    # back" rows is 0 since we bail before incrementing the counter.
    assert rolled == 0
    assert reservations.rows[0]["rolledBack"] is True
