"""Email delivery via Gmail SMTP.

In production we send real emails. In local dev, if SMTP credentials are
missing we log the message body to stdout so the OTP flow can still be
exercised end-to-end without configuring email yet.
"""

import os
import smtplib
import ssl
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText


SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASS = os.getenv("SMTP_PASS", "")
SMTP_FROM_NAME = os.getenv("SMTP_FROM_NAME", "ToSafePlace")
DEBUG = os.getenv("DEBUG", "False").lower() == "true"


def smtp_configured() -> bool:
    return bool(SMTP_USER and SMTP_PASS)


def send_email(to_email: str, subject: str, html_body: str, text_body: str) -> bool:
    """Send an email via Gmail SMTP. Returns True on success.

    If SMTP isn't configured, prints the message to the console (dev only)
    and returns False so callers know nothing was actually delivered."""
    if not smtp_configured():
        # Dev fallback — never reached in production where SMTP_* are set.
        if DEBUG:
            print(
                f"\n[mailer] SMTP not configured — would have sent:\n"
                f"  To: {to_email}\n"
                f"  Subject: {subject}\n"
                f"  Body:\n{text_body}\n"
            )
        return False

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"{SMTP_FROM_NAME} <{SMTP_USER}>"
    msg["To"] = to_email
    msg.attach(MIMEText(text_body, "plain"))
    msg.attach(MIMEText(html_body, "html"))

    context = ssl.create_default_context()
    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            server.starttls(context=context)
            server.login(SMTP_USER, SMTP_PASS)
            server.sendmail(SMTP_USER, [to_email], msg.as_string())
        return True
    except Exception as e:
        # Log but don't crash the API; the caller will surface a generic error.
        print(f"[mailer] SMTP send failed: {e}")
        return False
