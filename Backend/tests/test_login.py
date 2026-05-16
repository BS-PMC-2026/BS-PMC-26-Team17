import pytest
from httpx import AsyncClient, ASGITransport
from unittest.mock import AsyncMock, MagicMock, patch
from app.main import app


@pytest.mark.asyncio
async def test_login_success():
    """Correct credentials return user data."""
    existing_user = {
        "_id": "abc123",
        "email": "test@example.com",
        "password": "secret123",
        "firstName": "Test",
        "lastName": "User",
    }

    mock_collection = MagicMock()
    mock_collection.find_one = AsyncMock(return_value=existing_user)

    mock_db = MagicMock()
    mock_db.__getitem__ = MagicMock(return_value=mock_collection)

    with patch("app.routes.auth.db", mock_db):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.post("/auth/login", json={
                "email": "test@example.com",
                "password": "secret123"
            })

    assert response.status_code == 200
    data = response.json()
    assert data["message"] == "Login successful"
    assert data["user"]["email"] == "test@example.com"
    assert data["user"]["name"] == "Test User"


@pytest.mark.asyncio
async def test_login_wrong_password():
    """Wrong password returns 401."""
    existing_user = {
        "_id": "abc123",
        "email": "test@example.com",
        "password": "correctpassword",
        "firstName": "Test",
        "lastName": "User",
    }

    mock_collection = MagicMock()
    mock_collection.find_one = AsyncMock(return_value=existing_user)

    mock_db = MagicMock()
    mock_db.__getitem__ = MagicMock(return_value=mock_collection)

    with patch("app.routes.auth.db", mock_db):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.post("/auth/login", json={
                "email": "test@example.com",
                "password": "wrongpassword"
            })

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid email or password"


@pytest.mark.asyncio
async def test_login_user_not_found():
    """Non-existent email returns 401."""
    mock_collection = MagicMock()
    mock_collection.find_one = AsyncMock(return_value=None)

    mock_db = MagicMock()
    mock_db.__getitem__ = MagicMock(return_value=mock_collection)

    with patch("app.routes.auth.db", mock_db):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.post("/auth/login", json={
                "email": "nobody@example.com",
                "password": "secret123"
            })

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid email or password"


@pytest.mark.asyncio
async def test_login_missing_fields():
    """Missing password field returns 422."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/auth/login", json={
            "email": "test@example.com"
        })

    assert response.status_code == 422
