"""Unit tests for POST /shelters/{id}/reserve.

Mocks the db per-test (matches the project's existing test_*.py style).
The integration test in test_reservations_integration.py exercises the
upsert delta across multiple calls in sequence.
"""
import pytest
from bson import ObjectId
from unittest.mock import patch, MagicMock, AsyncMock


SHELTER_OID = ObjectId("65a1b2c3d4e5f6a7b8c9d0e1")
SHELTER_ID  = str(SHELTER_OID)


def _shelter_doc(**overrides):
    base = {
        "_id":              SHELTER_OID,
        "name":             "Test",
        "lat":              31.0, "lng": 34.0,
        "capacity":         10,
        "reservedPlaces":   0,
        "actualOccupancy":  0,
        "isFull":           False,
    }
    base.update(overrides)
    return base


def _mock_db_with(shelter, reservation_existing=None):
    """Build a MagicMock db where ShelterTest.find_one and ShelterReservation.find_one are scripted."""
    shelter_coll = MagicMock()
    shelter_coll.find_one = AsyncMock(return_value=shelter)
    shelter_coll.update_one = AsyncMock(return_value=MagicMock(modified_count=1))

    reservation_coll = MagicMock()
    reservation_coll.find_one = AsyncMock(return_value=reservation_existing)
    reservation_coll.insert_one = AsyncMock(
        return_value=MagicMock(inserted_id=ObjectId("65a1b2c3d4e5f6a7b8c9d0e2")),
    )
    reservation_coll.update_one = AsyncMock(return_value=MagicMock(modified_count=1))

    db = MagicMock()
    def getitem(name):
        if name == "ShelterTest":         return shelter_coll
        if name == "ShelterReservation":  return reservation_coll
        raise KeyError(name)
    db.__getitem__.side_effect = getitem
    return db, shelter_coll, reservation_coll


@pytest.mark.asyncio
async def test_reserve_returns_400_on_invalid_shelter_id(async_client):
    with patch("app.routes.shelters.db") as _db:
        res = await async_client.post(
            "/shelters/not-an-objectid/reserve",
            json={"user_id": "u1", "alert_id": "a1", "group_size": 1},
        )
    assert res.status_code == 400


@pytest.mark.asyncio
async def test_reserve_returns_404_when_shelter_missing(async_client):
    db, shelter_coll, _ = _mock_db_with(shelter=None)
    with patch("app.routes.shelters.db", db):
        res = await async_client.post(
            f"/shelters/{SHELTER_ID}/reserve",
            json={"user_id": "u1", "alert_id": "a1", "group_size": 1},
        )
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_reserve_inserts_new_row_and_increments_reservedPlaces(async_client):
    # Shelter state on first read (before insert), then post-update read.
    shelter_pre  = _shelter_doc(reservedPlaces=0)
    shelter_post = _shelter_doc(reservedPlaces=3)
    shelter_coll = MagicMock()
    shelter_coll.find_one = AsyncMock(side_effect=[shelter_pre, shelter_post])
    shelter_coll.update_one = AsyncMock(return_value=MagicMock(modified_count=1))

    reservation_coll = MagicMock()
    reservation_coll.find_one = AsyncMock(return_value=None)  # no existing row
    reservation_coll.insert_one = AsyncMock(
        return_value=MagicMock(inserted_id=ObjectId("65a1b2c3d4e5f6a7b8c9d0e2")),
    )
    reservation_coll.update_one = AsyncMock()

    db = MagicMock()
    db.__getitem__.side_effect = lambda n: {
        "ShelterTest": shelter_coll, "ShelterReservation": reservation_coll,
    }[n]

    with patch("app.routes.shelters.db", db):
        res = await async_client.post(
            f"/shelters/{SHELTER_ID}/reserve",
            json={"user_id": "u1", "alert_id": "a1", "alert_kind": "siren", "group_size": 3},
        )

    assert res.status_code == 200
    body = res.json()
    assert body["reservedPlaces"] == 3
    assert body["isFull"] is False
    assert body["shelter_id"] == SHELTER_ID
    assert body["reservation_id"]

    # Insert was called with the right fields
    reservation_coll.insert_one.assert_awaited_once()
    inserted = reservation_coll.insert_one.await_args.args[0]
    assert inserted["userId"] == "u1"
    assert inserted["shelterId"] == SHELTER_ID
    assert inserted["alertId"] == "a1"
    assert inserted["alertKind"] == "siren"
    assert inserted["groupSize"] == 3
    assert inserted["rolledBack"] is False

    # $inc reservedPlaces by +3
    shelter_coll.update_one.assert_any_await(
        {"_id": SHELTER_OID},
        {"$inc": {"reservedPlaces": 3}},
    )


@pytest.mark.asyncio
async def test_reserve_upserts_with_positive_delta(async_client):
    """Existing reservation of 2 → request 5 → delta should be +3."""
    existing = {
        "_id": ObjectId("65a1b2c3d4e5f6a7b8c9d0e3"),
        "userId": "u1", "shelterId": SHELTER_ID, "alertId": "a1",
        "groupSize": 2, "rolledBack": False,
    }
    shelter_pre  = _shelter_doc(reservedPlaces=2)
    shelter_post = _shelter_doc(reservedPlaces=5)
    shelter_coll = MagicMock()
    shelter_coll.find_one = AsyncMock(side_effect=[shelter_pre, shelter_post])
    shelter_coll.update_one = AsyncMock(return_value=MagicMock(modified_count=1))

    reservation_coll = MagicMock()
    reservation_coll.find_one = AsyncMock(return_value=existing)
    reservation_coll.insert_one = AsyncMock()
    reservation_coll.update_one = AsyncMock(return_value=MagicMock(modified_count=1))

    db = MagicMock()
    db.__getitem__.side_effect = lambda n: {
        "ShelterTest": shelter_coll, "ShelterReservation": reservation_coll,
    }[n]

    with patch("app.routes.shelters.db", db):
        res = await async_client.post(
            f"/shelters/{SHELTER_ID}/reserve",
            json={"user_id": "u1", "alert_id": "a1", "group_size": 5},
        )

    assert res.status_code == 200
    assert res.json()["reservedPlaces"] == 5
    assert res.json()["reservation_id"] == str(existing["_id"])
    reservation_coll.insert_one.assert_not_awaited()
    shelter_coll.update_one.assert_any_await(
        {"_id": SHELTER_OID},
        {"$inc": {"reservedPlaces": 3}},
    )


@pytest.mark.asyncio
async def test_reserve_upserts_with_negative_delta(async_client):
    """Existing 5 → request 1 → delta should be -4."""
    existing = {
        "_id": ObjectId("65a1b2c3d4e5f6a7b8c9d0e3"),
        "userId": "u1", "shelterId": SHELTER_ID, "alertId": "a1",
        "groupSize": 5, "rolledBack": False,
    }
    shelter_coll = MagicMock()
    shelter_coll.find_one = AsyncMock(side_effect=[
        _shelter_doc(reservedPlaces=5), _shelter_doc(reservedPlaces=1),
    ])
    shelter_coll.update_one = AsyncMock(return_value=MagicMock(modified_count=1))

    reservation_coll = MagicMock()
    reservation_coll.find_one = AsyncMock(return_value=existing)
    reservation_coll.update_one = AsyncMock()

    db = MagicMock()
    db.__getitem__.side_effect = lambda n: {
        "ShelterTest": shelter_coll, "ShelterReservation": reservation_coll,
    }[n]

    with patch("app.routes.shelters.db", db):
        res = await async_client.post(
            f"/shelters/{SHELTER_ID}/reserve",
            json={"user_id": "u1", "alert_id": "a1", "group_size": 1},
        )

    assert res.status_code == 200
    shelter_coll.update_one.assert_any_await(
        {"_id": SHELTER_OID},
        {"$inc": {"reservedPlaces": -4}},
    )


@pytest.mark.asyncio
async def test_reserve_same_size_does_not_inc_but_extends_ttl(async_client):
    existing = {
        "_id": ObjectId("65a1b2c3d4e5f6a7b8c9d0e3"),
        "userId": "u1", "shelterId": SHELTER_ID, "alertId": "a1",
        "groupSize": 3, "rolledBack": False,
    }
    shelter_coll = MagicMock()
    shelter_coll.find_one = AsyncMock(return_value=_shelter_doc(reservedPlaces=3))
    shelter_coll.update_one = AsyncMock(return_value=MagicMock(modified_count=1))

    reservation_coll = MagicMock()
    reservation_coll.find_one = AsyncMock(return_value=existing)
    reservation_coll.update_one = AsyncMock(return_value=MagicMock(modified_count=1))

    db = MagicMock()
    db.__getitem__.side_effect = lambda n: {
        "ShelterTest": shelter_coll, "ShelterReservation": reservation_coll,
    }[n]

    with patch("app.routes.shelters.db", db):
        res = await async_client.post(
            f"/shelters/{SHELTER_ID}/reserve",
            json={"user_id": "u1", "alert_id": "a1", "group_size": 3},
        )

    assert res.status_code == 200
    # No $inc call against the shelter's reservedPlaces
    for call in shelter_coll.update_one.await_args_list:
        update = call.args[1]
        assert "$inc" not in update or update.get("$inc", {}).get("reservedPlaces", 0) == 0
    # But the reservation's expiresAt was bumped
    reservation_coll.update_one.assert_awaited()
    assert "expiresAt" in reservation_coll.update_one.await_args.args[1]["$set"]


@pytest.mark.asyncio
async def test_reserve_sets_isFull_when_capacity_reached(async_client):
    """capacity=10, actual=2, new reserved=8 → total 10 → isFull flips True."""
    shelter_pre  = _shelter_doc(capacity=10, actualOccupancy=2, reservedPlaces=0, isFull=False)
    shelter_post = _shelter_doc(capacity=10, actualOccupancy=2, reservedPlaces=8, isFull=False)
    shelter_coll = MagicMock()
    shelter_coll.find_one = AsyncMock(side_effect=[shelter_pre, shelter_post])
    shelter_coll.update_one = AsyncMock(return_value=MagicMock(modified_count=1))

    reservation_coll = MagicMock()
    reservation_coll.find_one = AsyncMock(return_value=None)
    reservation_coll.insert_one = AsyncMock(
        return_value=MagicMock(inserted_id=ObjectId("65a1b2c3d4e5f6a7b8c9d0e2")),
    )

    db = MagicMock()
    db.__getitem__.side_effect = lambda n: {
        "ShelterTest": shelter_coll, "ShelterReservation": reservation_coll,
    }[n]

    with patch("app.routes.shelters.db", db):
        res = await async_client.post(
            f"/shelters/{SHELTER_ID}/reserve",
            json={"user_id": "u1", "alert_id": "a1", "group_size": 8},
        )

    assert res.status_code == 200
    assert res.json()["isFull"] is True
    # An explicit isFull=true write happened
    shelter_coll.update_one.assert_any_await(
        {"_id": SHELTER_OID},
        {"$set": {"isFull": True}},
    )


@pytest.mark.asyncio
async def test_reserve_skips_isFull_write_when_unchanged(async_client):
    """capacity=10, total=3 after → isFull stays False, no $set write."""
    shelter_pre  = _shelter_doc(capacity=10, reservedPlaces=0, isFull=False)
    shelter_post = _shelter_doc(capacity=10, reservedPlaces=3, isFull=False)
    shelter_coll = MagicMock()
    shelter_coll.find_one = AsyncMock(side_effect=[shelter_pre, shelter_post])
    shelter_coll.update_one = AsyncMock(return_value=MagicMock(modified_count=1))

    reservation_coll = MagicMock()
    reservation_coll.find_one = AsyncMock(return_value=None)
    reservation_coll.insert_one = AsyncMock(
        return_value=MagicMock(inserted_id=ObjectId("65a1b2c3d4e5f6a7b8c9d0e2")),
    )

    db = MagicMock()
    db.__getitem__.side_effect = lambda n: {
        "ShelterTest": shelter_coll, "ShelterReservation": reservation_coll,
    }[n]

    with patch("app.routes.shelters.db", db):
        res = await async_client.post(
            f"/shelters/{SHELTER_ID}/reserve",
            json={"user_id": "u1", "alert_id": "a1", "group_size": 3},
        )

    assert res.status_code == 200
    # No isFull write (only $inc reservedPlaces)
    for call in shelter_coll.update_one.await_args_list:
        update = call.args[1]
        assert "isFull" not in update.get("$set", {})


@pytest.mark.asyncio
@pytest.mark.parametrize("bad_size", [0, -1, 21, 100])
async def test_reserve_rejects_group_size_out_of_bounds(async_client, bad_size):
    res = await async_client.post(
        f"/shelters/{SHELTER_ID}/reserve",
        json={"user_id": "u1", "alert_id": "a1", "group_size": bad_size},
    )
    assert res.status_code == 422  # Pydantic validation
