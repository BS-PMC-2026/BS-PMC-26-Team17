"""Tests for /api/chat.

The Anthropic SDK is mocked at the `_get_client()` seam — we never
make a real network call to Claude. Covers:
  - Happy path: SDK is called with system prompt + messages, reply
    is extracted from the first text block.
  - Missing API key returns 503 (chat is unavailable, not a generic
    500), and we never instantiate the client.
  - SDK raising returns 502 with a friendly detail.
  - Pydantic validates the request (empty messages list → 422,
    bad role → 422, content too long → 422).
"""
import os
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import AsyncClient, ASGITransport

from app.main import app


@pytest.fixture
def client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _fake_response(text: str, *, input_tokens: int = 10, output_tokens: int = 20):
    """Build a stand-in for anthropic.types.Message."""
    return SimpleNamespace(
        content=[SimpleNamespace(type="text", text=text)],
        stop_reason="end_turn",
        usage=SimpleNamespace(
            input_tokens=input_tokens, output_tokens=output_tokens
        ),
    )


def _mock_anthropic_client(reply_text: str = "Hi there!"):
    """Returns an object shaped like AsyncAnthropic with messages.create."""
    client = MagicMock()
    client.messages = MagicMock()
    client.messages.create = AsyncMock(return_value=_fake_response(reply_text))
    return client


# Reset the module-level cached client between tests so a previous
# patch doesn't leak into the next test.
@pytest.fixture(autouse=True)
def _reset_chat_client():
    from app.routes import chat as chat_module
    chat_module._client = None
    yield
    chat_module._client = None


# ── Happy path ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_happy_path_returns_reply(client):
    mock = _mock_anthropic_client("Hello there!")

    with patch("app.routes.chat._get_client", return_value=mock):
        async with client as c:
            r = await c.post(
                "/api/chat",
                json={"messages": [{"role": "user", "content": "Hi"}]},
            )

    assert r.status_code == 200
    body = r.json()
    assert body["reply"] == "Hello there!"
    assert body["stop_reason"] == "end_turn"
    assert body["usage"] == {"input_tokens": 10, "output_tokens": 20}

    # SDK called once with the request fields we expect to send
    mock.messages.create.assert_awaited_once()
    kwargs = mock.messages.create.call_args.kwargs
    assert kwargs["model"] == "claude-haiku-4-5"
    assert kwargs["max_tokens"] == 400
    assert "ToSafePlace" in kwargs["system"]
    assert "abuse" in kwargs["system"].lower() or "insult" in kwargs["system"].lower()
    assert kwargs["messages"] == [{"role": "user", "content": "Hi"}]


@pytest.mark.asyncio
async def test_history_is_forwarded_in_order(client):
    """Full conversation history is passed to Anthropic so the model
    has context, not just the latest message."""
    mock = _mock_anthropic_client("Sure.")

    history = [
        {"role": "user", "content": "Hello"},
        {"role": "assistant", "content": "Hi! How can I help?"},
        {"role": "user", "content": "I'm feeling nervous."},
    ]

    with patch("app.routes.chat._get_client", return_value=mock):
        async with client as c:
            r = await c.post("/api/chat", json={"messages": history})

    assert r.status_code == 200
    assert mock.messages.create.call_args.kwargs["messages"] == history


@pytest.mark.asyncio
async def test_reply_concatenates_text_blocks(client):
    """If Claude returns multiple text blocks, we join them with newlines."""
    fake = SimpleNamespace(
        content=[
            SimpleNamespace(type="text", text="Part one."),
            SimpleNamespace(type="text", text="Part two."),
        ],
        stop_reason="end_turn",
        usage=SimpleNamespace(input_tokens=5, output_tokens=10),
    )
    mock = MagicMock()
    mock.messages = MagicMock()
    mock.messages.create = AsyncMock(return_value=fake)

    with patch("app.routes.chat._get_client", return_value=mock):
        async with client as c:
            r = await c.post(
                "/api/chat",
                json={"messages": [{"role": "user", "content": "Hi"}]},
            )

    assert r.status_code == 200
    assert r.json()["reply"] == "Part one.\nPart two."


# ── Missing config ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_missing_api_key_returns_503(client, monkeypatch):
    """No ANTHROPIC_API_KEY in env → 503 (chat not configured),
    and we never try to talk to Anthropic."""
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)

    async with client as c:
        r = await c.post(
            "/api/chat",
            json={"messages": [{"role": "user", "content": "Hi"}]},
        )

    assert r.status_code == 503
    assert "not configured" in r.json()["detail"].lower()


# ── SDK errors ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_sdk_exception_becomes_502(client):
    mock = MagicMock()
    mock.messages = MagicMock()
    mock.messages.create = AsyncMock(side_effect=RuntimeError("rate limited"))

    with patch("app.routes.chat._get_client", return_value=mock):
        async with client as c:
            r = await c.post(
                "/api/chat",
                json={"messages": [{"role": "user", "content": "Hi"}]},
            )

    assert r.status_code == 502
    # User-facing message must not leak the underlying error text
    assert "rate limited" not in r.json()["detail"]


# ── Validation ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_empty_messages_returns_422(client):
    async with client as c:
        r = await c.post("/api/chat", json={"messages": []})
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_invalid_role_returns_422(client):
    async with client as c:
        r = await c.post(
            "/api/chat",
            json={"messages": [{"role": "system", "content": "Hi"}]},
        )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_empty_content_returns_422(client):
    async with client as c:
        r = await c.post(
            "/api/chat",
            json={"messages": [{"role": "user", "content": ""}]},
        )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_content_too_long_returns_422(client):
    async with client as c:
        r = await c.post(
            "/api/chat",
            json={"messages": [{"role": "user", "content": "x" * 4001}]},
        )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_too_many_messages_returns_422(client):
    """The route caps history at 40 turns to keep per-call cost predictable."""
    msgs = [{"role": "user", "content": str(i)} for i in range(41)]
    async with client as c:
        r = await c.post("/api/chat", json={"messages": msgs})
    assert r.status_code == 422
