import pytest
from unittest.mock import patch, AsyncMock, MagicMock
from bson import ObjectId


# Valid 24-char ObjectId strings (admin / regular user / nonexistent)
ADMIN_ID   = "65a1b2c3d4e5f6a7b8c9d0e1"
USER_ID    = "65a1b2c3d4e5f6a7b8c9d0e2"
MISSING_ID = "65a1b2c3d4e5f6a7b8c9d0e3"


def _build_db_mock(found_user):
    """Build a mock where db['User'].find_one returns the given user."""
    mock_user_collection = MagicMock()
    mock_user_collection.find_one = AsyncMock(return_value=found_user)

    mock_shelter_collection = MagicMock()
    mock_shelter_collection.insert_one = AsyncMock(
        return_value=MagicMock(inserted_id=ObjectId("65a1b2c3d4e5f6a7b8c9d0ff"))
    )

    def get_collection(name):
        if name == "User":
            return mock_user_collection
        return mock_shelter_collection

    mock_db = MagicMock()
    mock_db.__getitem__.side_effect = get_collection
    return mock_db, mock_shelter_collection


def _valid_payload(user_id=ADMIN_ID):
    return {
        "user_id": user_id,
        "name": "Test Shelter A1",
        "address": "Herzl St. 10",
        "neighborhood": "Old City",
        "area": "Center",
        "city": "Be'er Sheva",
        "placeType": "public shelter",
        "capacity": 50,
        "accessStatus": "open",
        "isAccessible": True,
        "isFull": False,
        "hasStairs": False,
        "petIssueReported": False,
        "cleanlinessStatus": "clean",
        "shouldBeOpen": True,
    }


# ─────────────────────────────────────────────────────────
# Test 1: admin can create a shelter
# ─────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_admin_can_add_shelter(async_client):
    admin_user = {"_id": ObjectId(ADMIN_ID), "role": "admin", "email": "a@x.com"}
    mock_db, shelter_coll = _build_db_mock(admin_user)

    with patch("app.routes.shelters.db", mock_db):
        response = await async_client.post("/shelters", json=_valid_payload())

    assert response.status_code == 200
    data = response.json()
    assert data["message"] == "Shelter added"
    assert data["shelter"]["name"] == "Test Shelter A1"
    assert data["shelter"]["address"] == "Herzl St. 10"
    assert "id" in data["shelter"]
    shelter_coll.insert_one.assert_awaited_once()


# ─────────────────────────────────────────────────────────
# Test 2: regular user gets 403 Forbidden
# ─────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_non_admin_cannot_add_shelter(async_client):
    regular_user = {"_id": ObjectId(USER_ID), "role": "user", "email": "u@x.com"}
    mock_db, shelter_coll = _build_db_mock(regular_user)

    with patch("app.routes.shelters.db", mock_db):
        response = await async_client.post("/shelters", json=_valid_payload(user_id=USER_ID))

    assert response.status_code == 403
    assert response.json()["detail"] == "Admin access required"
    shelter_coll.insert_one.assert_not_awaited()


# ─────────────────────────────────────────────────────────
# Test 3: missing user (user_id not in DB) → 403
# ─────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_missing_user_cannot_add_shelter(async_client):
    mock_db, shelter_coll = _build_db_mock(found_user=None)

    with patch("app.routes.shelters.db", mock_db):
        response = await async_client.post("/shelters", json=_valid_payload(user_id=MISSING_ID))

    assert response.status_code == 403
    shelter_coll.insert_one.assert_not_awaited()


# ─────────────────────────────────────────────────────────
# Test 4: missing required field (name) → 422 from Pydantic
# ─────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_missing_name_returns_422(async_client):
    payload = _valid_payload()
    del payload["name"]
    response = await async_client.post("/shelters", json=payload)
    assert response.status_code == 422


# ─────────────────────────────────────────────────────────
# Test 5: missing required field (address) → 422
# ─────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_missing_address_returns_422(async_client):
    payload = _valid_payload()
    del payload["address"]
    response = await async_client.post("/shelters", json=payload)
    assert response.status_code == 422


# ─────────────────────────────────────────────────────────
# Test 6: missing user_id → 422
# ─────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_missing_user_id_returns_422(async_client):
    payload = _valid_payload()
    del payload["user_id"]
    response = await async_client.post("/shelters", json=payload)
    assert response.status_code == 422


# ─────────────────────────────────────────────────────────
# Test 7: defaults are applied when optional fields are omitted
# ─────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_defaults_applied_to_optional_fields(async_client):
    admin_user = {"_id": ObjectId(ADMIN_ID), "role": "admin"}
    mock_db, shelter_coll = _build_db_mock(admin_user)

    minimal_payload = {
        "user_id": ADMIN_ID,
        "name": "Minimal Shelter",
        "address": "Some St 1",
    }

    with patch("app.routes.shelters.db", mock_db):
        response = await async_client.post("/shelters", json=minimal_payload)

    assert response.status_code == 200
    saved = shelter_coll.insert_one.call_args[0][0]
    assert saved["placeType"] == "public shelter"
    assert saved["accessStatus"] == "open"
    assert saved["capacity"] == 0
    assert saved["isAccessible"] is False
    assert "user_id" not in saved  # should be stripped before saving


# ─────────────────────────────────────────────────────────
# Test 8: invalid ObjectId in user_id → 403 (treated as not admin)
# ─────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_invalid_user_id_returns_403(async_client):
    payload = _valid_payload(user_id="not-a-valid-objectid")
    response = await async_client.post("/shelters", json=payload)
    assert response.status_code == 403
