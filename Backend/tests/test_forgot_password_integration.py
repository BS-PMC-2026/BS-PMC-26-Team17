"""Integration tests for the forgot-password / reset-password flow.

Runs the real FastAPI endpoints against an in-memory fake Mongo:
  - The User collection so we can register / look up users
  - The PasswordReset collection so OTPs persist between requests
Email delivery is mocked so no real SMTP traffic is generated.

The whole flow is end-to-end: register → forgot-password (emit OTP) →
verify-reset-code → reset-password → login with the new password.
"""
import asyncio
import re
from datetime import datetime, timedelta, timezone

import pytest
from bson import ObjectId
from unittest.mock import MagicMock, patch
from httpx import AsyncClient, ASGITransport

from app.main import app


# ── Fake collections ────────────────────────────────────────────────────────

class FakeCollection:
    """In-memory stand-in for a Mongo collection with the methods this flow uses."""

    def __init__(self):
        self.docs = []

    def _match(self, doc, query):
        return all(doc.get(k) == v for k, v in query.items())

    async def find_one(self, query):
        for d in self.docs:
            if self._match(d, query):
                return d
        return None

    async def insert_one(self, doc):
        doc.setdefault("_id", ObjectId())
        self.docs.append(doc)
        result = MagicMock()
        result.inserted_id = doc["_id"]
        return result

    async def update_one(self, query, update, upsert=False):
        existing = await self.find_one(query)
        result = MagicMock()
        if existing:
            existing.update(update.get("$set", {}))
            result.matched_count = 1
        elif upsert:
            new_doc = {**query, **update.get("$set", {})}
            await self.insert_one(new_doc)
            result.matched_count = 0
        else:
            result.matched_count = 0
        return result

    async def delete_one(self, query):
        for i, d in enumerate(self.docs):
            if self._match(d, query):
                self.docs.pop(i)
                result = MagicMock()
                result.deleted_count = 1
                return result
        result = MagicMock()
        result.deleted_count = 0
        return result


@pytest.fixture
def fake_db():
    """Routes db["User"] and db["PasswordReset"] to in-memory fakes."""
    users = FakeCollection()
    resets = FakeCollection()

    def get_collection(name):
        return {"User": users, "PasswordReset": resets}.get(name, FakeCollection())

    db = MagicMock()
    db.__getitem__ = MagicMock(side_effect=get_collection)
    return db, users, resets


@pytest.fixture
def patched_routes(fake_db):
    """Patches the db used by auth.py to point at the fake collections.
    Also stubs out send_email so tests don't try to talk to Gmail."""
    db, users, resets = fake_db
    with patch("app.routes.auth.db", db), \
         patch("app.routes.auth.send_email") as send_mock:
        send_mock.return_value = True
        yield users, resets, send_mock


@pytest.fixture
def async_client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


# ── Helpers ────────────────────────────────────────────────────────────────

REGISTER_PAYLOAD = {
    "firstName": "Alice",
    "lastName": "B",
    "email": "alice@example.com",
    "password": "old-password",
    "telephone": "0501234567",
    "address": "Herzl 1, Tel Aviv",
}


async def register_user(client, payload=REGISTER_PAYLOAD):
    return await client.post("/auth/register", json=payload)


def captured_otp(send_email_mock) -> str:
    """Pull the 6-digit code out of the most recent send_email() call."""
    assert send_email_mock.called, "send_email was never called"
    last = send_email_mock.call_args
    body = last.kwargs.get("text_body") or last.kwargs.get("html_body") or ""
    m = re.search(r"\b(\d{6})\b", body)
    assert m, f"No 6-digit code in email body: {body[:200]}"
    return m.group(1)


# ── Tests ───────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_full_reset_flow(async_client, patched_routes):
    """Happy path: register → request code → verify → reset → login with new password."""
    users, resets, send_mock = patched_routes

    # 1. Register
    r = await async_client.post("/auth/register", json=REGISTER_PAYLOAD)
    assert r.status_code == 200

    # 2. Request a reset code
    r = await async_client.post(
        "/auth/forgot-password",
        json={"email": REGISTER_PAYLOAD["email"]},
    )
    assert r.status_code == 200
    # Generic message — never leaks whether the email was real
    assert "code" in r.json()["message"].lower() or "sent" in r.json()["message"].lower()

    # The mailer was invoked with a body containing the OTP
    code = captured_otp(send_mock)
    assert len(resets.docs) == 1, "PasswordReset record should have been created"

    # 3. Verify the code (doesn't consume it)
    r = await async_client.post(
        "/auth/verify-reset-code",
        json={"email": REGISTER_PAYLOAD["email"], "code": code},
    )
    assert r.status_code == 200
    assert r.json()["valid"] is True

    # Record still there — verify doesn't delete
    assert len(resets.docs) == 1

    # 4. Reset password with the new one
    r = await async_client.post(
        "/auth/reset-password",
        json={
            "email": REGISTER_PAYLOAD["email"],
            "code": code,
            "new_password": "brand-new-password",
        },
    )
    assert r.status_code == 200

    # Reset record is gone (single-use)
    assert len(resets.docs) == 0

    # 5. Login with the new password works…
    r = await async_client.post(
        "/auth/login",
        json={"email": REGISTER_PAYLOAD["email"], "password": "brand-new-password"},
    )
    assert r.status_code == 200

    # …and the old one no longer does
    r = await async_client.post(
        "/auth/login",
        json={"email": REGISTER_PAYLOAD["email"], "password": REGISTER_PAYLOAD["password"]},
    )
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_forgot_password_for_unknown_email_returns_generic(
    async_client, patched_routes,
):
    """Endpoint must not reveal whether an email is registered."""
    users, resets, send_mock = patched_routes
    r = await async_client.post(
        "/auth/forgot-password",
        json={"email": "ghost@nowhere.com"},
    )
    assert r.status_code == 200
    # No record created, no email sent — but the response is the same shape
    assert len(resets.docs) == 0
    send_mock.assert_not_called()


@pytest.mark.asyncio
async def test_verify_with_wrong_code_returns_400(async_client, patched_routes):
    users, resets, send_mock = patched_routes
    await async_client.post("/auth/register", json=REGISTER_PAYLOAD)
    await async_client.post(
        "/auth/forgot-password",
        json={"email": REGISTER_PAYLOAD["email"]},
    )

    r = await async_client.post(
        "/auth/verify-reset-code",
        json={"email": REGISTER_PAYLOAD["email"], "code": "000000"},
    )
    assert r.status_code == 400
    assert "invalid" in r.json()["detail"].lower()


@pytest.mark.asyncio
async def test_reset_with_wrong_code_does_not_change_password(
    async_client, patched_routes,
):
    users, resets, send_mock = patched_routes
    await async_client.post("/auth/register", json=REGISTER_PAYLOAD)
    await async_client.post(
        "/auth/forgot-password",
        json={"email": REGISTER_PAYLOAD["email"]},
    )

    r = await async_client.post(
        "/auth/reset-password",
        json={
            "email": REGISTER_PAYLOAD["email"],
            "code": "000000",
            "new_password": "attacker-password",
        },
    )
    assert r.status_code == 400

    # Original password still works
    r = await async_client.post(
        "/auth/login",
        json={"email": REGISTER_PAYLOAD["email"], "password": REGISTER_PAYLOAD["password"]},
    )
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_expired_code_is_rejected(async_client, patched_routes):
    users, resets, send_mock = patched_routes
    await async_client.post("/auth/register", json=REGISTER_PAYLOAD)
    await async_client.post(
        "/auth/forgot-password",
        json={"email": REGISTER_PAYLOAD["email"]},
    )
    code = captured_otp(send_mock)

    # Force the stored record's expiry into the past
    resets.docs[0]["expires_at"] = datetime.now(timezone.utc) - timedelta(minutes=1)

    r = await async_client.post(
        "/auth/verify-reset-code",
        json={"email": REGISTER_PAYLOAD["email"], "code": code},
    )
    assert r.status_code == 400
    assert "expired" in r.json()["detail"].lower()

    r = await async_client.post(
        "/auth/reset-password",
        json={
            "email": REGISTER_PAYLOAD["email"],
            "code": code,
            "new_password": "x",
        },
    )
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_cooldown_blocks_rapid_resend(async_client, patched_routes):
    """A second forgot-password call within the cooldown window returns 429."""
    users, resets, send_mock = patched_routes
    await async_client.post("/auth/register", json=REGISTER_PAYLOAD)

    r1 = await async_client.post(
        "/auth/forgot-password",
        json={"email": REGISTER_PAYLOAD["email"]},
    )
    assert r1.status_code == 200

    r2 = await async_client.post(
        "/auth/forgot-password",
        json={"email": REGISTER_PAYLOAD["email"]},
    )
    assert r2.status_code == 429
    # Only one email actually sent
    assert send_mock.call_count == 1


@pytest.mark.asyncio
async def test_second_forgot_password_request_replaces_old_code(
    async_client, patched_routes,
):
    """If we get past the cooldown, a new request invalidates the old code."""
    users, resets, send_mock = patched_routes
    await async_client.post("/auth/register", json=REGISTER_PAYLOAD)

    await async_client.post(
        "/auth/forgot-password",
        json={"email": REGISTER_PAYLOAD["email"]},
    )
    first_code = captured_otp(send_mock)

    # Move the stored record's created_at out of the cooldown window
    resets.docs[0]["created_at"] = datetime.now(timezone.utc) - timedelta(minutes=2)

    await async_client.post(
        "/auth/forgot-password",
        json={"email": REGISTER_PAYLOAD["email"]},
    )
    second_code = captured_otp(send_mock)

    # The first code should be gone — only the new one is valid
    r = await async_client.post(
        "/auth/verify-reset-code",
        json={"email": REGISTER_PAYLOAD["email"], "code": first_code},
    )
    # If they happen to collide (1-in-a-million chance), skip
    if first_code != second_code:
        assert r.status_code == 400

    r = await async_client.post(
        "/auth/verify-reset-code",
        json={"email": REGISTER_PAYLOAD["email"], "code": second_code},
    )
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_reset_password_requires_non_empty_password(
    async_client, patched_routes,
):
    users, resets, send_mock = patched_routes
    await async_client.post("/auth/register", json=REGISTER_PAYLOAD)
    await async_client.post(
        "/auth/forgot-password",
        json={"email": REGISTER_PAYLOAD["email"]},
    )
    code = captured_otp(send_mock)

    r = await async_client.post(
        "/auth/reset-password",
        json={
            "email": REGISTER_PAYLOAD["email"],
            "code": code,
            "new_password": "",
        },
    )
    assert r.status_code == 400
