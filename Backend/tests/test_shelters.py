import pytest
from unittest.mock import patch, MagicMock, AsyncMock
from bson import ObjectId


def make_async_iter(items):
    class AsyncIter:
        def __init__(self, data):
            self._iter = iter(data)
        def __aiter__(self):
            return self
        async def __anext__(self):
            try:
                return next(self._iter)
            except StopIteration:
                raise StopAsyncIteration
    return AsyncIter(items)


@pytest.mark.asyncio
async def test_get_shelters_returns_list(async_client):
    mock_shelter = {
        "_id": ObjectId("65a1b2c3d4e5f6a7b8c9d0e1"),
        "name": "מקלט בן גוריון",
        "address": "בן גוריון 33",
        "area": "מרכז",
        "placeType": "public shelter",
        "capacity": 200,
        "accessStatus": "open",
        "isAccessible": True,
        "isFull": False,
        "hasStairs": False,
        "petIssueReported": False,
        "shouldBeOpen": True,
        "cleanlinessStatus": "clean",
    }

    with patch("app.routes.shelters.db") as mock_db:
        mock_db.__getitem__.return_value.find.return_value.limit.return_value = make_async_iter([mock_shelter])
        response = await async_client.get("/shelters")
        assert response.status_code == 200
        data = response.json()
        assert "shelters" in data
        assert "count" in data
        assert isinstance(data["shelters"], list)


@pytest.mark.asyncio
async def test_filter_by_area(async_client):
    with patch("app.routes.shelters.db") as mock_db:
        mock_db.__getitem__.return_value.find.return_value.limit.return_value = make_async_iter([])
        response = await async_client.get("/shelters?area=צפון")
        assert response.status_code == 200


@pytest.mark.asyncio
async def test_filter_by_status(async_client):
    with patch("app.routes.shelters.db") as mock_db:
        mock_db.__getitem__.return_value.find.return_value.limit.return_value = make_async_iter([])
        response = await async_client.get("/shelters?status=open")
        assert response.status_code == 200


@pytest.mark.asyncio
async def test_search_by_name(async_client):
    with patch("app.routes.shelters.db") as mock_db:
        mock_db.__getitem__.return_value.find.return_value.limit.return_value = make_async_iter([])
        response = await async_client.get("/shelters?search=מקלט")
        assert response.status_code == 200


@pytest.mark.asyncio
async def test_filter_by_city(async_client):
    with patch("app.routes.shelters.db") as mock_db:
        mock_db.__getitem__.return_value.find.return_value.limit.return_value = make_async_iter([])
        response = await async_client.get("/shelters?city=Be'er Sheva")
        assert response.status_code == 200


@pytest.mark.asyncio
async def test_filter_by_place_type(async_client):
    with patch("app.routes.shelters.db") as mock_db:
        mock_db.__getitem__.return_value.find.return_value.limit.return_value = make_async_iter([])
        response = await async_client.get("/shelters?place_type=school")
        assert response.status_code == 200


@pytest.mark.asyncio
async def test_no_results(async_client):
    with patch("app.routes.shelters.db") as mock_db:
        mock_db.__getitem__.return_value.find.return_value.limit.return_value = make_async_iter([])
        response = await async_client.get("/shelters?search=doesnotexist")
        assert response.status_code == 200
        data = response.json()
        assert data["count"] == 0
        assert data["shelters"] == []


@pytest.mark.asyncio
async def test_multiple_filters(async_client):
    with patch("app.routes.shelters.db") as mock_db:
        mock_db.__getitem__.return_value.find.return_value.limit.return_value = make_async_iter([])
        response = await async_client.get("/shelters?area=צפון&status=open")
        assert response.status_code == 200


@pytest.mark.asyncio
async def test_returns_correct_count(async_client):
    shelters = [
        {"_id": ObjectId("65a1b2c3d4e5f6a7b8c9d0a1"), "name": "מקלט א", "accessStatus": "open"},
        {"_id": ObjectId("65a1b2c3d4e5f6a7b8c9d0a2"), "name": "מקלט ב", "accessStatus": "open"},
    ]
    with patch("app.routes.shelters.db") as mock_db:
        mock_db.__getitem__.return_value.find.return_value.limit.return_value = make_async_iter(shelters)
        response = await async_client.get("/shelters")
        assert response.status_code == 200
        data = response.json()
        assert data["count"] == 2
        assert len(data["shelters"]) == 2


# ── Status filter content tests ──────────────────────────────────────────────

@pytest.mark.asyncio
async def test_status_open_filters_correct_shelters(async_client):
    """status=open must pass accessStatus='open' to the DB query and return only open shelters."""
    open_shelter = {
        "_id": ObjectId("65a1b2c3d4e5f6a7b8c9d0c1"),
        "name": "מקלט פתוח",
        "accessStatus": "open",
    }
    with patch("app.routes.shelters.db") as mock_db:
        mock_db.__getitem__.return_value.find.return_value.limit.return_value = make_async_iter([open_shelter])
        response = await async_client.get("/shelters?status=open")

    assert response.status_code == 200
    data = response.json()
    # Verify the query that reached MongoDB contained the right filter
    query = mock_db.__getitem__.return_value.find.call_args.args[0]
    assert query.get("accessStatus") == "open"
    # All returned shelters must have accessStatus open
    assert data["count"] == 1
    assert all(s["accessStatus"] == "open" for s in data["shelters"])


@pytest.mark.asyncio
async def test_status_locked_filters_correct_shelters(async_client):
    """status=locked must pass accessStatus='locked' to the DB query and return only locked shelters."""
    locked_shelter = {
        "_id": ObjectId("65a1b2c3d4e5f6a7b8c9d0c2"),
        "name": "מקלט נעול",
        "accessStatus": "locked",
    }
    with patch("app.routes.shelters.db") as mock_db:
        mock_db.__getitem__.return_value.find.return_value.limit.return_value = make_async_iter([locked_shelter])
        response = await async_client.get("/shelters?status=locked")

    assert response.status_code == 200
    data = response.json()
    query = mock_db.__getitem__.return_value.find.call_args.args[0]
    assert query.get("accessStatus") == "locked"
    assert data["count"] == 1
    assert all(s["accessStatus"] == "locked" for s in data["shelters"])


# ── City / Area filter content tests ─────────────────────────────────────────

@pytest.mark.asyncio
async def test_city_filter_passes_correct_query(async_client):
    """city=Be'er Sheva must pass city='Be\\'er Sheva' to the DB query."""
    shelter = {
        "_id": ObjectId("65a1b2c3d4e5f6a7b8c9d0c3"),
        "name": "מקלט בבאר שבע",
        "city": "Be'er Sheva",
        "accessStatus": "open",
    }
    with patch("app.routes.shelters.db") as mock_db:
        mock_db.__getitem__.return_value.find.return_value.limit.return_value = make_async_iter([shelter])
        response = await async_client.get("/shelters?city=Be'er Sheva")

    assert response.status_code == 200
    data = response.json()
    query = mock_db.__getitem__.return_value.find.call_args.args[0]
    assert query.get("city") == "Be'er Sheva"
    assert data["count"] == 1
    assert data["shelters"][0]["city"] == "Be'er Sheva"


@pytest.mark.asyncio
async def test_area_filter_passes_correct_query(async_client):
    """area=North must pass area='North' to the DB query."""
    shelter = {
        "_id": ObjectId("65a1b2c3d4e5f6a7b8c9d0c4"),
        "name": "מקלט צפון",
        "area": "North",
        "accessStatus": "open",
    }
    with patch("app.routes.shelters.db") as mock_db:
        mock_db.__getitem__.return_value.find.return_value.limit.return_value = make_async_iter([shelter])
        response = await async_client.get("/shelters?area=North")

    assert response.status_code == 200
    data = response.json()
    query = mock_db.__getitem__.return_value.find.call_args.args[0]
    assert query.get("area") == "North"
    assert data["count"] == 1
    assert data["shelters"][0]["area"] == "North"


# ── Combined filter test ──────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_combined_filters_build_correct_query(async_client):
    """city + area + status together must all appear in the DB query."""
    shelter = {
        "_id": ObjectId("65a1b2c3d4e5f6a7b8c9d0c5"),
        "name": "מקלט משולב",
        "city": "Be'er Sheva",
        "area": "North",
        "accessStatus": "open",
    }
    with patch("app.routes.shelters.db") as mock_db:
        mock_db.__getitem__.return_value.find.return_value.limit.return_value = make_async_iter([shelter])
        response = await async_client.get("/shelters?city=Be'er Sheva&area=North&status=open")

    assert response.status_code == 200
    data = response.json()
    query = mock_db.__getitem__.return_value.find.call_args.args[0]
    assert query.get("city") == "Be'er Sheva"
    assert query.get("area") == "North"
    assert query.get("accessStatus") == "open"
    assert data["count"] == 1


# ── Shared constants and helper ──────────────────────────────────────────────

ADMIN_ID     = "65a1b2c3d4e5f6a7b8c9d0e4"
NON_ADMIN_ID = "65a1b2c3d4e5f6a7b8c9d0e5"
SHELTER_OID  = "65a1b2c3d4e5f6a7b8c9d0e6"


def build_shelters_db_mock(*, user=None, update_matched=1, delete_count=1):
    user_coll = MagicMock()
    user_coll.find_one = AsyncMock(return_value=user)

    shelter_coll = MagicMock()
    shelter_coll.insert_one = AsyncMock(
        return_value=MagicMock(inserted_id=ObjectId(SHELTER_OID))
    )
    shelter_coll.update_one = AsyncMock(
        return_value=MagicMock(matched_count=update_matched)
    )
    shelter_coll.delete_one = AsyncMock(
        return_value=MagicMock(deleted_count=delete_count)
    )

    def get_collection(name):
        return {"User": user_coll, "ShelterTest": shelter_coll}.get(name, MagicMock())

    db = MagicMock()
    db.__getitem__.side_effect = get_collection
    return db, shelter_coll


# ── POST /shelters ───────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_shelter_admin_success(async_client):
    db, _ = build_shelters_db_mock(
        user={"_id": ObjectId(ADMIN_ID), "role": "admin"},
    )
    with patch("app.routes.shelters.db", db):
        response = await async_client.post("/shelters", json={
            "user_id": ADMIN_ID,
            "name": "מקלט חדש",
            "address": "רחוב הרצל 1",
        })
    assert response.status_code == 200
    data = response.json()
    assert data["message"] == "Shelter added"
    assert "shelter" in data


@pytest.mark.asyncio
async def test_create_shelter_non_admin_forbidden(async_client):
    db, _ = build_shelters_db_mock(
        user={"_id": ObjectId(NON_ADMIN_ID), "role": "user"},
    )
    with patch("app.routes.shelters.db", db):
        response = await async_client.post("/shelters", json={
            "user_id": NON_ADMIN_ID,
            "name": "מקלט חדש",
            "address": "רחוב הרצל 1",
        })
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_create_shelter_missing_name_returns_422(async_client):
    response = await async_client.post("/shelters", json={
        "user_id": ADMIN_ID,
        "address": "רחוב הרצל 1",
    })
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_create_shelter_missing_address_returns_422(async_client):
    response = await async_client.post("/shelters", json={
        "user_id": ADMIN_ID,
        "name": "מקלט חדש",
    })
    assert response.status_code == 422


# ── PATCH /shelters/{shelter_id} ─────────────────────────────────────────────

@pytest.mark.asyncio
async def test_update_shelter_access_status(async_client):
    db, _ = build_shelters_db_mock(
        user={"_id": ObjectId(ADMIN_ID), "role": "admin"},
    )
    with patch("app.routes.shelters.db", db):
        response = await async_client.patch(f"/shelters/{SHELTER_OID}", json={
            "user_id": ADMIN_ID,
            "accessStatus": "locked",
        })
    assert response.status_code == 200
    assert response.json()["message"] == "Shelter updated"


@pytest.mark.asyncio
async def test_update_shelter_multiple_fields(async_client):
    db, shelter_coll = build_shelters_db_mock(
        user={"_id": ObjectId(ADMIN_ID), "role": "admin"},
    )
    with patch("app.routes.shelters.db", db):
        response = await async_client.patch(f"/shelters/{SHELTER_OID}", json={
            "user_id": ADMIN_ID,
            "cleanlinessStatus": "dirty",
            "hasStairs": True,
        })
    assert response.status_code == 200
    updates = shelter_coll.update_one.call_args.args[1]["$set"]
    assert updates.get("cleanlinessStatus") == "dirty"
    assert updates.get("hasStairs") is True


@pytest.mark.asyncio
async def test_update_shelter_non_admin_forbidden(async_client):
    db, _ = build_shelters_db_mock(
        user={"_id": ObjectId(NON_ADMIN_ID), "role": "user"},
    )
    with patch("app.routes.shelters.db", db):
        response = await async_client.patch(f"/shelters/{SHELTER_OID}", json={
            "user_id": NON_ADMIN_ID,
            "accessStatus": "locked",
        })
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_update_shelter_not_found(async_client):
    db, _ = build_shelters_db_mock(
        user={"_id": ObjectId(ADMIN_ID), "role": "admin"},
        update_matched=0,
    )
    with patch("app.routes.shelters.db", db):
        response = await async_client.patch(f"/shelters/{SHELTER_OID}", json={
            "user_id": ADMIN_ID,
            "accessStatus": "locked",
        })
    assert response.status_code == 404


# ── DELETE /shelters/{shelter_id} ────────────────────────────────────────────

@pytest.mark.asyncio
async def test_delete_shelter_admin_success(async_client):
    db, _ = build_shelters_db_mock(
        user={"_id": ObjectId(ADMIN_ID), "role": "admin"},
    )
    with patch("app.routes.shelters.db", db):
        response = await async_client.delete(f"/shelters/{SHELTER_OID}?user_id={ADMIN_ID}")
    assert response.status_code == 200
    assert response.json()["message"] == "Shelter deleted"


@pytest.mark.asyncio
async def test_delete_shelter_non_admin_forbidden(async_client):
    db, _ = build_shelters_db_mock(
        user={"_id": ObjectId(NON_ADMIN_ID), "role": "user"},
    )
    with patch("app.routes.shelters.db", db):
        response = await async_client.delete(f"/shelters/{SHELTER_OID}?user_id={NON_ADMIN_ID}")
    assert response.status_code == 403