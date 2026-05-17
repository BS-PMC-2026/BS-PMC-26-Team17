"""Integration tests for the register -> login flow.

Unlike the unit tests (test_register.py / test_login.py) which mock the DB
per-request, these tests run both endpoints against the SAME in-memory fake
DB so that a user registered in step 1 can actually be logged in in step 2.
This exercises the real FastAPI pipeline, Pydantic validation, route logic,
and the contract between the two endpoints.
"""
import pytest
from bson import ObjectId
from httpx import AsyncClient, ASGITransport
from unittest.mock import AsyncMock, MagicMock, patch
from app.main import app


class FakeUserCollection:
    """Minimal in-memory stand-in for the Mongo `User` collection."""

    def __init__(self):
        self.users = []

    async def find_one(self, query):
        for u in self.users:
            if all(u.get(k) == v for k, v in query.items()):
                return u
        return None

    async def insert_one(self, doc):
        doc["_id"] = ObjectId()
        self.users.append(doc)
        result = MagicMock()
        result.inserted_id = doc["_id"]
        return result


@pytest.fixture
def fake_db():
    collection = FakeUserCollection()
    db = MagicMock()
    db.__getitem__ = MagicMock(return_value=collection)
    return db, collection


@pytest.mark.asyncio
async def test_register_then_login_flow(fake_db):
    """Full happy path: register a new user and log in with the same credentials."""
    db, _ = fake_db

    user_payload = {
        "firstName": "Alice",
        "lastName": "Smith",
        "email": "alice@example.com",
        "password": "secret123",
        "telephone": "0501112222",
        "address": "Tel Aviv",
    }

    with patch("app.routes.auth.db", db):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            reg = await client.post("/auth/register", json=user_payload)
            assert reg.status_code == 200
            assert reg.json()["message"] == "User registered successfully"

            login = await client.post("/auth/login", json={
                "email": user_payload["email"],
                "password": user_payload["password"],
            })

    assert login.status_code == 200
    data = login.json()
    assert data["message"] == "Login successful"
    assert data["user"]["email"] == "alice@example.com"
    assert data["user"]["name"] == "Alice Smith"
    assert data["user"]["role"] == "user"
    assert data["user"]["telephone"] == "0501112222"
    assert data["user"]["id"]


@pytest.mark.asyncio
async def test_register_duplicate_rejected_after_first_register(fake_db):
    """Registering the same email twice fails on the second attempt."""
    db, _ = fake_db

    payload = {
        "firstName": "Bob",
        "lastName": "Jones",
        "email": "bob@example.com",
        "password": "pw",
        "telephone": "0500000000",
        "address": "Haifa",
    }

    with patch("app.routes.auth.db", db):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            first = await client.post("/auth/register", json=payload)
            assert first.status_code == 200

            second = await client.post("/auth/register", json=payload)

    assert second.status_code == 400
    assert second.json()["detail"] == "User already exists"


@pytest.mark.asyncio
async def test_login_after_register_wrong_password_rejected(fake_db):
    """Register succeeds but login with wrong password is rejected."""
    db, _ = fake_db

    with patch("app.routes.auth.db", db):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            reg = await client.post("/auth/register", json={
                "firstName": "Carol",
                "lastName": "King",
                "email": "carol@example.com",
                "password": "correct-pw",
                "telephone": "0509998888",
                "address": "Jerusalem",
            })
            assert reg.status_code == 200

            bad = await client.post("/auth/login", json={
                "email": "carol@example.com",
                "password": "wrong-pw",
            })

    assert bad.status_code == 401
    assert bad.json()["detail"] == "Invalid email or password"


@pytest.mark.asyncio
async def test_admin_role_assigned_for_admin_password(fake_db):
    """Registering with the special admin password grants the admin role on login."""
    db, _ = fake_db

    with patch("app.routes.auth.db", db):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            await client.post("/auth/register", json={
                "firstName": "Admin",
                "lastName": "User",
                "email": "admin@example.com",
                "password": "admin123",
                "telephone": "0500000001",
                "address": "HQ",
            })
            login = await client.post("/auth/login", json={
                "email": "admin@example.com",
                "password": "admin123",
            })

    assert login.status_code == 200
    assert login.json()["user"]["role"] == "admin"
