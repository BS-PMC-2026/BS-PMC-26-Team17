"""Unit tests for the Expo Push API client (app/core/push.py).

Mocks httpx so no real network traffic; verifies the contract we send to
Expo's servers and how we react to various response shapes.
"""
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.routes.MessageAll.push import send_expo_push, EXPO_PUSH_URL


def _make_response(status_code: int, text: str = ""):
    resp = MagicMock()
    resp.status_code = status_code
    resp.text = text
    return resp


@pytest.mark.asyncio
async def test_send_expo_push_returns_false_for_empty_tokens():
    """No tokens → no network call, returns False."""
    with patch("app.core.push.httpx.AsyncClient") as client_mock:
        ok = await send_expo_push([], "title", "body")
    assert ok is False
    # Should never have attempted to open an HTTP client
    client_mock.assert_not_called()


@pytest.mark.asyncio
async def test_send_expo_push_filters_invalid_tokens():
    """Tokens that don't start with `ExponentPushToken[` are silently dropped.
    If all are invalid, no request is made."""
    with patch("app.core.push.httpx.AsyncClient") as client_mock:
        ok = await send_expo_push(["not-a-token", "", "fake"], "t", "b")
    assert ok is False
    client_mock.assert_not_called()


@pytest.mark.asyncio
async def test_send_expo_push_returns_true_on_200():
    valid_token = "ExponentPushToken[abc123]"
    ctx = MagicMock()
    ctx.__aenter__ = AsyncMock(return_value=MagicMock(post=AsyncMock(return_value=_make_response(200, '{"data":"ok"}'))))
    ctx.__aexit__ = AsyncMock(return_value=False)
    with patch("app.core.push.httpx.AsyncClient", return_value=ctx):
        ok = await send_expo_push([valid_token], "Title", "Body", {"foo": "bar"})

    assert ok is True


@pytest.mark.asyncio
async def test_send_expo_push_returns_false_on_non_200():
    valid_token = "ExponentPushToken[abc123]"
    ctx = MagicMock()
    ctx.__aenter__ = AsyncMock(return_value=MagicMock(post=AsyncMock(return_value=_make_response(500, "Server error"))))
    ctx.__aexit__ = AsyncMock(return_value=False)
    with patch("app.core.push.httpx.AsyncClient", return_value=ctx):
        ok = await send_expo_push([valid_token], "Title", "Body")

    assert ok is False


@pytest.mark.asyncio
async def test_send_expo_push_returns_false_on_exception():
    """Network errors must never raise — background tasks would crash."""
    valid_token = "ExponentPushToken[abc123]"
    ctx = MagicMock()
    ctx.__aenter__ = AsyncMock(side_effect=Exception("connection refused"))
    ctx.__aexit__ = AsyncMock(return_value=False)
    with patch("app.core.push.httpx.AsyncClient", return_value=ctx):
        ok = await send_expo_push([valid_token], "Title", "Body")

    assert ok is False


@pytest.mark.asyncio
async def test_send_expo_push_builds_correct_payload():
    """Verify we send exactly what Expo expects: one message per token,
    each with `to`, `title`, `body`, `data`, priority and channel."""
    tokens = ["ExponentPushToken[a]", "ExponentPushToken[b]"]
    post_mock = AsyncMock(return_value=_make_response(200, '{"data":"ok"}'))
    client = MagicMock(post=post_mock)
    ctx = MagicMock()
    ctx.__aenter__ = AsyncMock(return_value=client)
    ctx.__aexit__ = AsyncMock(return_value=False)
    with patch("app.core.push.httpx.AsyncClient", return_value=ctx):
        await send_expo_push(tokens, "T", "B", {"shelterId": "X"})

    post_mock.assert_awaited_once()
    args, kwargs = post_mock.call_args
    assert args[0] == EXPO_PUSH_URL
    messages = kwargs["json"]
    assert len(messages) == 2
    for m, tok in zip(messages, tokens):
        assert m["to"] == tok
        assert m["title"] == "T"
        assert m["body"] == "B"
        assert m["data"] == {"shelterId": "X"}
        assert m["priority"] == "high"
        assert m["sound"] == "default"
        assert m["channelId"] == "default"
