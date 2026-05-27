"""Unit tests for the mailer module.

Mocks smtplib so no real SMTP traffic is generated. Covers:
  - smtp_configured() returns the right thing based on env state
  - send_email() returns False when SMTP isn't configured (dev fallback)
  - send_email() actually invokes login/sendmail with the right args on success
  - send_email() returns False (doesn't raise) when SMTP errors out
"""
import importlib
from unittest.mock import MagicMock, patch

import pytest


@pytest.fixture
def mailer_module(monkeypatch):
    """Reload the mailer with controllable env vars per-test.

    The mailer reads env at import time, so we monkeypatch BEFORE importing it.
    Tests use the returned module rather than a top-level import.
    """
    def _load(user="user@example.com", password="pw", debug="False"):
        monkeypatch.setenv("SMTP_USER", user)
        monkeypatch.setenv("SMTP_PASS", password)
        monkeypatch.setenv("DEBUG", debug)
        from app.core import mailer
        return importlib.reload(mailer)

    return _load


# ── smtp_configured ─────────────────────────────────────────────────────────

def test_smtp_configured_true_when_user_and_pass_set(mailer_module):
    m = mailer_module(user="me@example.com", password="secret")
    assert m.smtp_configured() is True


def test_smtp_configured_false_when_user_missing(mailer_module):
    m = mailer_module(user="", password="secret")
    assert m.smtp_configured() is False


def test_smtp_configured_false_when_password_missing(mailer_module):
    m = mailer_module(user="me@example.com", password="")
    assert m.smtp_configured() is False


# ── send_email — dev fallback ──────────────────────────────────────────────

def test_send_email_returns_false_when_not_configured(mailer_module, capsys):
    """No SMTP creds → returns False, logs to stdout in DEBUG mode."""
    m = mailer_module(user="", password="", debug="True")
    ok = m.send_email(
        to_email="alice@example.com",
        subject="hi",
        html_body="<p>hi</p>",
        text_body="hi",
    )
    assert ok is False
    out = capsys.readouterr().out
    assert "alice@example.com" in out
    assert "hi" in out


def test_send_email_silent_when_debug_false(mailer_module, capsys):
    """Without DEBUG, the dev fallback shouldn't spam stdout."""
    m = mailer_module(user="", password="", debug="False")
    ok = m.send_email(
        to_email="alice@example.com",
        subject="hi",
        html_body="<p>hi</p>",
        text_body="hi",
    )
    assert ok is False
    out = capsys.readouterr().out
    assert "alice@example.com" not in out


# ── send_email — real send path ────────────────────────────────────────────

def test_send_email_invokes_smtp_correctly(mailer_module):
    m = mailer_module(user="me@example.com", password="secret")

    fake_server = MagicMock()
    # The `with smtplib.SMTP(...) as server:` block returns the server
    fake_smtp_ctx = MagicMock()
    fake_smtp_ctx.__enter__ = MagicMock(return_value=fake_server)
    fake_smtp_ctx.__exit__ = MagicMock(return_value=False)

    with patch.object(m, "smtplib") as smtplib_mock:
        smtplib_mock.SMTP.return_value = fake_smtp_ctx
        ok = m.send_email(
            to_email="alice@example.com",
            subject="Test",
            html_body="<p>hello</p>",
            text_body="hello",
        )

    assert ok is True
    # SMTP was opened with our host/port and the connection was upgraded to TLS
    smtplib_mock.SMTP.assert_called_once()
    fake_server.starttls.assert_called_once()
    fake_server.login.assert_called_once_with("me@example.com", "secret")
    # sendmail was called with the right from/to
    sm_call = fake_server.sendmail.call_args
    assert sm_call.args[0] == "me@example.com"
    assert sm_call.args[1] == ["alice@example.com"]
    # And the raw message includes our subject + bodies
    raw = sm_call.args[2]
    assert "Subject: Test" in raw
    assert "hello" in raw


def test_send_email_returns_false_on_smtp_exception(mailer_module, capsys):
    """SMTP failures shouldn't crash the API — return False, log, move on."""
    m = mailer_module(user="me@example.com", password="secret")

    with patch.object(m, "smtplib") as smtplib_mock:
        smtplib_mock.SMTP.side_effect = Exception("connection refused")
        ok = m.send_email(
            to_email="alice@example.com",
            subject="Test",
            html_body="<p>x</p>",
            text_body="x",
        )

    assert ok is False
    err = capsys.readouterr().out
    assert "SMTP send failed" in err
