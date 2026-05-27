"""Tests for /api/settings.

POST updates the user document with the camelCase field names the
codebase uses (homeLat/homeLng/exclusionRadius/mobilityType/isAccessible).
GET returns those same fields under the snake_case wire format.

The settings router is registered in app/main.py — if the include_router
call gets removed, every test in this file will 404 and surface the bug.
"""
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from bson import ObjectId
from httpx import AsyncClient, ASGITransport

from app.main import app


@pytest.fixture
def client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.mark.asyncio
async def test_post_settings_updates_user_doc(client):
    user_id = ObjectId()
    user_coll = MagicMock()
    user_coll.update_one = AsyncMock(return_value=MagicMock(matched_count=1))

    db = MagicMock()
    db.__getitem__.side_effect = lambda name: {"User": user_coll}[name]

    with patch("app.routes.settings.db", db):
        async with client as c:
            r = await c.post(
                "/api/settings",
                json={
                    "user_id": str(user_id),
                    "address": "Herzl 1, Tel Aviv",
                    "home_lat": 32.0853,
                    "home_lng": 34.7818,
                    "exclusion_radius": 500.0,
                    "transport_mode": "walking",
                    "is_handicapped": False,
                },
            )

    assert r.status_code == 200
    user_coll.update_one.assert_awaited_once()
    filt, update = user_coll.update_one.call_args.args
    assert filt == {"_id": user_id}
    written = update["$set"]
    assert written["address"] == "Herzl 1, Tel Aviv"
    assert written["homeLat"] == 32.0853
    assert written["homeLng"] == 34.7818
    assert written["exclusionRadius"] == 500.0
    assert written["mobilityType"] == "walking"
    assert written["isAccessible"] is False


@pytest.mark.asyncio
async def test_post_settings_invalid_id_returns_400(client):
    db = MagicMock()
    with patch("app.routes.settings.db", db):
        async with client as c:
            r = await c.post(
                "/api/settings",
                json={
                    "user_id": "not-an-objectid",
                    "address": "x",
                    "home_lat": 0,
                    "home_lng": 0,
                    "exclusion_radius": 0,
                    "transport_mode": "walking",
                    "is_handicapped": False,
                },
            )
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_post_settings_unknown_user_returns_404(client):
    user_coll = MagicMock()
    user_coll.update_one = AsyncMock(return_value=MagicMock(matched_count=0))
    db = MagicMock()
    db.__getitem__.side_effect = lambda name: {"User": user_coll}[name]

    with patch("app.routes.settings.db", db):
        async with client as c:
            r = await c.post(
                "/api/settings",
                json={
                    "user_id": str(ObjectId()),
                    "address": "x",
                    "home_lat": 0,
                    "home_lng": 0,
                    "exclusion_radius": 0,
                    "transport_mode": "walking",
                    "is_handicapped": False,
                },
            )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_get_settings_returns_user_fields(client):
    user = {
        "_id": ObjectId(),
        "address": "Herzl 1, Tel Aviv",
        "homeLat": 32.0853,
        "homeLng": 34.7818,
        "exclusionRadius": 500.0,
        "mobilityType": "cycling",
        "isAccessible": True,
    }
    user_coll = MagicMock()
    user_coll.find_one = AsyncMock(return_value=user)
    db = MagicMock()
    db.__getitem__.side_effect = lambda name: {"User": user_coll}[name]

    with patch("app.routes.settings.db", db):
        async with client as c:
            r = await c.get(f"/api/settings/{str(user['_id'])}")

    assert r.status_code == 200
    body = r.json()
    assert body == {
        "address": "Herzl 1, Tel Aviv",
        "home_lat": 32.0853,
        "home_lng": 34.7818,
        "exclusion_radius": 500.0,
        "transport_mode": "cycling",
        "is_handicapped": True,
    }


@pytest.mark.asyncio
async def test_get_settings_unknown_user_returns_404(client):
    user_coll = MagicMock()
    user_coll.find_one = AsyncMock(return_value=None)
    db = MagicMock()
    db.__getitem__.side_effect = lambda name: {"User": user_coll}[name]

    with patch("app.routes.settings.db", db):
        async with client as c:
            r = await c.get(f"/api/settings/{str(ObjectId())}")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_get_settings_invalid_id_returns_400(client):
    db = MagicMock()
    with patch("app.routes.settings.db", db):
        async with client as c:
            r = await c.get("/api/settings/not-an-objectid")
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_get_settings_uses_defaults_for_missing_fields(client):
    """A fresh User doc has no exclusionRadius / mobilityType yet — the
    route must fill in safe defaults rather than 500."""
    user = {"_id": ObjectId(), "address": "", "homeLat": 0, "homeLng": 0}
    user_coll = MagicMock()
    user_coll.find_one = AsyncMock(return_value=user)
    db = MagicMock()
    db.__getitem__.side_effect = lambda name: {"User": user_coll}[name]

    with patch("app.routes.settings.db", db):
        async with client as c:
            r = await c.get(f"/api/settings/{str(user['_id'])}")

    assert r.status_code == 200
    body = r.json()
    assert body["exclusion_radius"] == 0.0
    assert body["transport_mode"] == "walking"
    assert body["is_handicapped"] is False
