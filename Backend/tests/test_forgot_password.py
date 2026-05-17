"""Unit tests for the forgot-password / verify / reset endpoints.

Each test mocks the db per-request and stubs out send_email, exercising
ONE endpoint at a time. The end-to-end happy path is covered separately
in test_forgot_password_integration.py.
"""
from datetime import datetime, timedelta, timezone

import pytest
from bson import ObjectId
from unittest.mock import AsyncMock, MagicMock, patch
from httpx import AsyncClient, ASGITransport

from app.main import app


USER_ID = "65a1b2c3d4e5f6a7b8c9d0e1"
EMAIL = "alice@example.com"


def build_db_mock(*, user=None, reset_record=None):
    """Returns a db mock that routes by collection name.

    - db["User"].find_one  → returns `user` (or None)
    - db["User"].update_one → returns matched_count=1 if `user` was supplied
    - db["PasswordReset"].find_one → returns `reset_record`
    - db["PasswordReset"].update_one / delete_one → no-op recorders
    """
    user_coll = MagicMock()
    user_coll.find_one = AsyncMock(return_value=user)
    user_coll.update_one = AsyncMock(
        return_value=MagicMock(matched_count=1 if user else 0)
    )

    reset_coll = MagicMock()
    reset_coll.find_one = AsyncMock(return_value=reset_record)
    reset_coll.update_one = AsyncMock(return_value=MagicMock(matched_count=0))
    reset_coll.delete_one = AsyncMock(return_value=MagicMock(deleted_count=1))

    db = MagicMock()
    db.__getitem__.side_effect = lambda name: {
        "User": user_coll,
        "PasswordReset": reset_coll,
    }[name]
    return db, user_coll, reset_coll


@pytest.fixture
def client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


# ── /auth/forgot-password ──────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_forgot_password_known_email_sends_code(client):
    db, _, reset_coll = build_db_mock(user={"_id": ObjectId(USER_ID), "email": EMAIL})
    with patch("app.routes.auth.db", db), \
         patch("app.routes.auth.send_email") as send_mock:
        send_mock.return_value = True
        async with client as c:
            r = await c.post("/auth/forgot-password", json={"email": EMAIL})

    assert r.status_code == 200
    # A reset record was upserted
    reset_coll.update_one.assert_awaited_once()
    upsert_args = reset_coll.update_one.call_args
    assert upsert_args.kwargs.get("upsert") is True
    # The code we generated was passed to send_email
    send_mock.assert_called_once()
    code_in_body = send_mock.call_args.kwargs["text_body"]
    assert any(ch.isdigit() for ch in code_in_body)


@pytest.mark.asyncio
async def test_forgot_password_unknown_email_returns_generic_no_email(client):
    """Even for a missing user, the response shape is the same — no email sent."""
    db, _, reset_coll = build_db_mock(user=None)
    with patch("app.routes.auth.db", db), \
         patch("app.routes.auth.send_email") as send_mock:
        async with client as c:
            r = await c.post("/auth/forgot-password", json={"email": "ghost@nowhere.com"})

    assert r.status_code == 200
    send_mock.assert_not_called()
    reset_coll.update_one.assert_not_called()


@pytest.mark.asyncio
async def test_forgot_password_cooldown_returns_429(client):
    """A previous record younger than the cooldown blocks a fresh send."""
    just_now = datetime.now(timezone.utc) - timedelta(seconds=5)
    db, _, _ = build_db_mock(
        user={"_id": ObjectId(USER_ID), "email": EMAIL},
        reset_record={"email": EMAIL, "code": "111111", "created_at": just_now},
    )
    with patch("app.routes.auth.db", db), \
         patch("app.routes.auth.send_email") as send_mock:
        async with client as c:
            r = await c.post("/auth/forgot-password", json={"email": EMAIL})

    assert r.status_code == 429
    assert "wait" in r.json()["detail"].lower()
    send_mock.assert_not_called()


# ── /auth/verify-reset-code ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_verify_reset_code_valid(client):
    future = datetime.now(timezone.utc) + timedelta(minutes=5)
    db, _, _ = build_db_mock(
        reset_record={"email": EMAIL, "code": "123456", "expires_at": future},
    )
    with patch("app.routes.auth.db", db):
        async with client as c:
            r = await c.post(
                "/auth/verify-reset-code",
                json={"email": EMAIL, "code": "123456"},
            )

    assert r.status_code == 200
    assert r.json() == {"valid": True}


@pytest.mark.asyncio
async def test_verify_reset_code_wrong_code(client):
    future = datetime.now(timezone.utc) + timedelta(minutes=5)
    db, _, _ = build_db_mock(
        reset_record={"email": EMAIL, "code": "123456", "expires_at": future},
    )
    with patch("app.routes.auth.db", db):
        async with client as c:
            r = await c.post(
                "/auth/verify-reset-code",
                json={"email": EMAIL, "code": "000000"},
            )

    assert r.status_code == 400


@pytest.mark.asyncio
async def test_verify_reset_code_no_record(client):
    db, _, _ = build_db_mock(reset_record=None)
    with patch("app.routes.auth.db", db):
        async with client as c:
            r = await c.post(
                "/auth/verify-reset-code",
                json={"email": EMAIL, "code": "123456"},
            )

    assert r.status_code == 400


@pytest.mark.asyncio
async def test_verify_reset_code_expired(client):
    past = datetime.now(timezone.utc) - timedelta(minutes=1)
    db, _, _ = build_db_mock(
        reset_record={"email": EMAIL, "code": "123456", "expires_at": past},
    )
    with patch("app.routes.auth.db", db):
        async with client as c:
            r = await c.post(
                "/auth/verify-reset-code",
                json={"email": EMAIL, "code": "123456"},
            )

    assert r.status_code == 400
    assert "expired" in r.json()["detail"].lower()


# ── /auth/reset-password ───────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_reset_password_success(client):
    future = datetime.now(timezone.utc) + timedelta(minutes=5)
    db, user_coll, reset_coll = build_db_mock(
        user={"_id": ObjectId(USER_ID), "email": EMAIL, "password": "old"},
        reset_record={"email": EMAIL, "code": "123456", "expires_at": future},
    )
    with patch("app.routes.auth.db", db):
        async with client as c:
            r = await c.post(
                "/auth/reset-password",
                json={"email": EMAIL, "code": "123456", "new_password": "new-pw"},
            )

    assert r.status_code == 200
    # The user's password was updated…
    user_coll.update_one.assert_awaited_once()
    update_call = user_coll.update_one.call_args
    assert update_call.args[1] == {"$set": {"password": "new-pw"}}
    # …and the reset record was consumed
    reset_coll.delete_one.assert_awaited_once()


@pytest.mark.asyncio
async def test_reset_password_wrong_code_does_not_touch_user(client):
    future = datetime.now(timezone.utc) + timedelta(minutes=5)
    db, user_coll, reset_coll = build_db_mock(
        user={"_id": ObjectId(USER_ID), "email": EMAIL, "password": "old"},
        reset_record={"email": EMAIL, "code": "123456", "expires_at": future},
    )
    with patch("app.routes.auth.db", db):
        async with client as c:
            r = await c.post(
                "/auth/reset-password",
                json={"email": EMAIL, "code": "000000", "new_password": "new-pw"},
            )

    assert r.status_code == 400
    user_coll.update_one.assert_not_awaited()
    reset_coll.delete_one.assert_not_awaited()


@pytest.mark.asyncio
async def test_reset_password_expired_code(client):
    past = datetime.now(timezone.utc) - timedelta(minutes=1)
    db, user_coll, reset_coll = build_db_mock(
        user={"_id": ObjectId(USER_ID), "email": EMAIL, "password": "old"},
        reset_record={"email": EMAIL, "code": "123456", "expires_at": past},
    )
    with patch("app.routes.auth.db", db):
        async with client as c:
            r = await c.post(
                "/auth/reset-password",
                json={"email": EMAIL, "code": "123456", "new_password": "new-pw"},
            )

    assert r.status_code == 400
    user_coll.update_one.assert_not_awaited()
    reset_coll.delete_one.assert_not_awaited()


@pytest.mark.asyncio
async def test_reset_password_empty_password(client):
    future = datetime.now(timezone.utc) + timedelta(minutes=5)
    db, user_coll, reset_coll = build_db_mock(
        user={"_id": ObjectId(USER_ID), "email": EMAIL, "password": "old"},
        reset_record={"email": EMAIL, "code": "123456", "expires_at": future},
    )
    with patch("app.routes.auth.db", db):
        async with client as c:
            r = await c.post(
                "/auth/reset-password",
                json={"email": EMAIL, "code": "123456", "new_password": ""},
            )

    assert r.status_code == 400
    user_coll.update_one.assert_not_awaited()


@pytest.mark.asyncio
async def test_reset_password_missing_required_field(client):
    """Pydantic rejects payload missing `code`."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.post(
            "/auth/reset-password",
            json={"email": EMAIL, "new_password": "x"},
        )
    assert r.status_code == 422


# ── Helper: OTP generator ──────────────────────────────────────────────────

def test_generate_otp_is_six_digits():
    from app.routes.auth import _generate_otp
    for _ in range(20):
        code = _generate_otp()
        assert len(code) == 6
        assert code.isdigit()


def test_generate_otp_is_random():
    """It should not return the same value back-to-back (extremely unlikely)."""
    from app.routes.auth import _generate_otp
    codes = {_generate_otp() for _ in range(50)}
    # With 50 draws from 1,000,000 possibilities, collisions vanishingly rare
    assert len(codes) >= 49


def test_otp_email_bodies_include_code():
    from app.routes.auth import _otp_email_bodies
    text, html = _otp_email_bodies("482103")
    assert "482103" in text
    assert "482103" in html
    assert "10 minutes" in text  # expiry mention
