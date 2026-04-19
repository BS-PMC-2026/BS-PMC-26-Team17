import pytest
from httpx import AsyncClient, ASGITransport
from unittest.mock import AsyncMock, MagicMock, patch
from app.main import app


@pytest.mark.asyncio
async def test_register_success():
    """New user registers successfully."""
    mock_collection = MagicMock()
    mock_collection.find_one = AsyncMock(return_value=None)
    mock_collection.insert_one = AsyncMock(return_value=MagicMock(inserted_id="abc123"))

    mock_db = MagicMock()
    mock_db.__getitem__ = MagicMock(return_value=mock_collection)

    with patch("app.routes.auth.db", mock_db):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.post("/auth/register", json={
                "firstName": "John",
                "lastName": "Doe",
                "email": "john@example.com",
                "password": "pass123",
                "telephone": "0501234567",
                "address": "123 Main St",
            })

    assert response.status_code == 200
    assert response.json()["message"] == "User registered successfully"


@pytest.mark.asyncio
async def test_register_duplicate_email():
    """Duplicate email returns 400."""
    mock_collection = MagicMock()
    mock_collection.find_one = AsyncMock(return_value={"email": "john@example.com"})

    mock_db = MagicMock()
    mock_db.__getitem__ = MagicMock(return_value=mock_collection)

    with patch("app.routes.auth.db", mock_db):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.post("/auth/register", json={
                "firstName": "John",
                "lastName": "Doe",
                "email": "john@example.com",
                "password": "pass123",
                "telephone": "0501234567",
                "address": "123 Main St",
            })

    assert response.status_code == 400
    assert response.json()["detail"] == "User already exists"


@pytest.mark.asyncio
async def test_register_missing_fields():
    """Missing required fields returns 422."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/auth/register", json={
            "firstName": "John",
            "email": "john@example.com",
            "password": "pass123",
        })

    assert response.status_code == 422
