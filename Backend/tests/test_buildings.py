"""Tests for /buildings endpoints (BSPMT17-371 / 374).

Covers building registration, cancellation, and the my/check helper
endpoints. Follows the mocking pattern used by test_shelters.py — the Mongo
client is patched and predefined documents / responses are returned.
"""
import pytest
from unittest.mock import patch, MagicMock, AsyncMock
from bson import ObjectId


VALID_OID = "65a1b2c3d4e5f6a7b8c9d0e1"
OTHER_OID = "65a1b2c3d4e5f6a7b8c9d0e2"
# register_building looks up the user by ObjectId to verify their address,
# so user_id must be a valid 24-char hex string in tests that hit that path.
USER_ID = "65a1b2c3d4e5f6a7b8c9d0e3"
OTHER_USER_ID = "65a1b2c3d4e5f6a7b8c9d0e4"


def _mock_shelter_doc(**overrides):
    """A registration doc as it would appear in ShelterTest after register."""
    base = {
        "_id": ObjectId(VALID_OID),
        "name": "רוטנברג 65 - מרתף",
        "address": "רוטנברג 65",
        "city": "באר שבע",
        "managerUserId": USER_ID,
        "apartmentCount": 12,
        "shelterLocation": "מרתף",
        "registrationStatus": "pending",
        "isActive": False,
        "isVisibleOnMap": False,
    }
    base.update(overrides)
    return base


# ---------------------------------------------------------------------------
# Cancel endpoint (BSPMT17-374)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_cancel_happy_path(async_client):
    """Owner cancels their own active registration → 200, status updated."""
    update_mock = AsyncMock()
    with patch("app.routes.buildings.db") as mock_db:
        coll = MagicMock()
        coll.find_one = AsyncMock(return_value=_mock_shelter_doc())
        coll.update_one = update_mock
        mock_db.__getitem__.return_value = coll

        response = await async_client.post(
            f"/buildings/{VALID_OID}/cancel",
            json={"user_id": USER_ID, "reason": "Building demolished"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["message"] == "Registration cancelled"
        assert data["id"] == VALID_OID

        # Verify the $set payload carried the expected fields
        update_mock.assert_awaited_once()
        _filter, update = update_mock.call_args.args
        payload = update["$set"]
        assert payload["registrationStatus"] == "cancelled"
        assert payload["isActive"] is False
        assert payload["isVisibleOnMap"] is False
        assert payload["cancelReason"] == "Building demolished"
        assert "cancelledAt" in payload


@pytest.mark.asyncio
async def test_cancel_wrong_owner(async_client):
    """Different user_id than managerUserId → 403."""
    with patch("app.routes.buildings.db") as mock_db:
        coll = MagicMock()
        coll.find_one = AsyncMock(return_value=_mock_shelter_doc())
        mock_db.__getitem__.return_value = coll

        response = await async_client.post(
            f"/buildings/{VALID_OID}/cancel",
            json={"user_id": OTHER_USER_ID},
        )

        assert response.status_code == 403


@pytest.mark.asyncio
async def test_cancel_bad_id(async_client):
    """Non-ObjectId string → 400."""
    response = await async_client.post(
        "/buildings/not-an-objectid/cancel",
        json={"user_id": USER_ID},
    )
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_cancel_not_found(async_client):
    """Valid ObjectId but no doc → 404."""
    with patch("app.routes.buildings.db") as mock_db:
        coll = MagicMock()
        coll.find_one = AsyncMock(return_value=None)
        mock_db.__getitem__.return_value = coll

        response = await async_client.post(
            f"/buildings/{OTHER_OID}/cancel",
            json={"user_id": USER_ID},
        )

        assert response.status_code == 404


@pytest.mark.asyncio
async def test_cancel_without_reason(async_client):
    """`reason` is optional — POST without it succeeds and stores empty."""
    update_mock = AsyncMock()
    with patch("app.routes.buildings.db") as mock_db:
        coll = MagicMock()
        coll.find_one = AsyncMock(return_value=_mock_shelter_doc())
        coll.update_one = update_mock
        mock_db.__getitem__.return_value = coll

        response = await async_client.post(
            f"/buildings/{VALID_OID}/cancel",
            json={"user_id": USER_ID},
        )

        assert response.status_code == 200
        payload = update_mock.call_args.args[1]["$set"]
        assert payload["cancelReason"] == ""


# ---------------------------------------------------------------------------
# my/{user_id}
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_my_returns_null_when_no_active_registration(async_client):
    """If all the user's registrations are cancelled → registration is null."""
    with patch("app.routes.buildings.db") as mock_db:
        coll = MagicMock()
        coll.find_one = AsyncMock(return_value=None)
        mock_db.__getitem__.return_value = coll

        response = await async_client.get(f"/buildings/my/{USER_ID}")

        assert response.status_code == 200
        assert response.json() == {"registration": None}


@pytest.mark.asyncio
async def test_my_returns_doc_without_file_blob(async_client):
    """The base64 file is stripped from the response so settings stays light."""
    doc = _mock_shelter_doc(
        registrationFileBase64="JVBERi0xLjQK...big-blob...",
        registrationFileName="permit.pdf",
    )
    with patch("app.routes.buildings.db") as mock_db:
        coll = MagicMock()
        coll.find_one = AsyncMock(return_value=doc)
        mock_db.__getitem__.return_value = coll

        response = await async_client.get(f"/buildings/my/{USER_ID}")

        assert response.status_code == 200
        reg = response.json()["registration"]
        assert reg["id"] == VALID_OID
        assert "registrationFileBase64" not in reg
        assert reg["registrationFileName"] == "permit.pdf"


# ---------------------------------------------------------------------------
# Address duplicate check
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_check_address_free(async_client):
    """No existing registration for this address → exists False."""
    with patch("app.routes.buildings.db") as mock_db:
        coll = MagicMock()
        coll.find_one = AsyncMock(return_value=None)
        mock_db.__getitem__.return_value = coll

        response = await async_client.get(
            "/buildings/check",
            params={"address": "רוטנברג 65", "city": "באר שבע"},
        )

        assert response.status_code == 200
        body = response.json()
        assert body == {"exists": False, "status": None}


@pytest.mark.asyncio
async def test_check_address_taken(async_client):
    """Existing pending registration → exists True with status."""
    with patch("app.routes.buildings.db") as mock_db:
        coll = MagicMock()
        coll.find_one = AsyncMock(return_value=_mock_shelter_doc())
        mock_db.__getitem__.return_value = coll

        response = await async_client.get(
            "/buildings/check",
            params={"address": "רוטנברג 65", "city": "באר שבע"},
        )

        assert response.status_code == 200
        assert response.json() == {"exists": True, "status": "pending"}


# ---------------------------------------------------------------------------
# Register endpoint
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_register_blocks_when_user_has_active_registration(async_client):
    """User already has an active registration → 400."""
    with patch("app.routes.buildings.db") as mock_db:
        coll = MagicMock()
        # First find_one (manager check) returns an existing doc
        coll.find_one = AsyncMock(return_value=_mock_shelter_doc())
        mock_db.__getitem__.return_value = coll

        response = await async_client.post(
            "/buildings/register",
            json={
                "user_id": USER_ID,
                "address": "רוטנברג 65",
                "lat": 31.25, "lng": 34.80,
                "city": "באר שבע",
                "apartmentCount": 10,
                "shelterLocation": "מרתף",
            },
        )

        assert response.status_code == 400


@pytest.mark.asyncio
async def test_register_blocks_when_address_already_registered(async_client):
    """Different user, same address → 409."""
    with patch("app.routes.buildings.db") as mock_db:
        coll = MagicMock()
        # First call: no existing reg for THIS user.
        # Second call: address already registered by someone else.
        coll.find_one = AsyncMock(
            side_effect=[None, _mock_shelter_doc(managerUserId=OTHER_USER_ID)]
        )
        mock_db.__getitem__.return_value = coll

        response = await async_client.post(
            "/buildings/register",
            json={
                "user_id": USER_ID,
                "address": "רוטנברג 65",
                "lat": 31.25, "lng": 34.80,
                "city": "באר שבע",
                "apartmentCount": 10,
                "shelterLocation": "מרתף",
            },
        )

        assert response.status_code == 409


@pytest.mark.asyncio
async def test_register_success_stores_hidden_doc(async_client):
    """Happy path → 200, doc inserted with isActive/isVisibleOnMap False."""
    insert_result = MagicMock()
    insert_result.inserted_id = ObjectId(VALID_OID)
    insert_mock = AsyncMock(return_value=insert_result)

    with patch("app.routes.buildings.db") as mock_db:
        coll = MagicMock()
        # Three find_one calls happen in order:
        #   1. existing-registration-for-this-user → None (no dup)
        #   2. existing-registration-for-this-address → None (no dup)
        #   3. User lookup for address match → user lives at this address
        coll.find_one = AsyncMock(side_effect=[
            None,
            None,
            {"address": "רוטנברג 65"},
        ])
        coll.insert_one = insert_mock
        mock_db.__getitem__.return_value = coll

        response = await async_client.post(
            "/buildings/register",
            json={
                "user_id": USER_ID,
                "address": "רוטנברג 65",
                "lat": 31.25, "lng": 34.80,
                "city": "באר שבע",
                "apartmentCount": 12,
                "shelterLocation": "מרתף",
            },
        )

        assert response.status_code == 200
        assert response.json()["id"] == VALID_OID

        # The inserted doc must keep the building hidden until admin approves
        inserted_doc = insert_mock.call_args.args[0]
        assert inserted_doc["isActive"] is False
        assert inserted_doc["isVisibleOnMap"] is False
        assert inserted_doc["registrationStatus"] == "pending"
        assert inserted_doc["managerUserId"] == USER_ID
