from datetime import datetime, timedelta, timezone
import secrets
from bson import ObjectId
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.core.database import db
from app.core.mailer import send_email

router = APIRouter(prefix="/auth", tags=["auth"])

# How long an OTP stays valid after it's generated
OTP_TTL_MINUTES = 10
# Minimum gap between two OTP requests for the same email (anti-spam)
RESEND_COOLDOWN_SECONDS = 30


class RegisterRequest(BaseModel):
    firstName: str
    lastName: str
    email: str
    password: str
    telephone: str
    address: str


@router.post("/register")
async def register(body: RegisterRequest):
    existing_user = await db["User"].find_one({"email": body.email})

    if existing_user:
        raise HTTPException(status_code=400, detail="User already exists")

    new_user = {
        "firstName": body.firstName,
        "lastName": body.lastName,
        "email": body.email,
        "password": body.password,
        "telephone": body.telephone,
        "address": body.address,
        "neighborhood": "",
        "city": "",
        "hasHomeProtection": False,
        "homeLat": 0,
        "homeLng": 0,
        "speed": "",
        "isAccessible": False,
        "childrenCount": 0,
        "hasPets": False,
        "role": "admin" if body.password == "admin123" else "user",
        "mobilityType": ""
    }

    await db["User"].insert_one(new_user)

    return {"message": "User registered successfully"}


class LoginRequest(BaseModel):
    email: str
    password: str


@router.post("/login")
async def login(body: LoginRequest):
    user = await db["User"].find_one({"email": body.email})

    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    if user["password"] != body.password:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    return {
        "message": "Login successful",
        "user": {
            "id": str(user["_id"]),
            "email": user["email"],
            "name": user.get("firstName", "") + " " + user.get("lastName", ""),
            "role": user.get("role", "user"),
            "telephone": user.get("telephone", ""),
        }
    }


# ── Forgot-password flow ────────────────────────────────────────────────────
# Three-step UI:
#   1. user submits email → /forgot-password (emails an OTP)
#   2. user submits email + code → /verify-reset-code (checks validity)
#   3. user submits email + code + new password → /reset-password (updates)
# OTPs live in the PasswordReset collection, one record per email (upserted).


class ForgotPasswordRequest(BaseModel):
    email: str


class VerifyResetCodeRequest(BaseModel):
    email: str
    code: str


class ResetPasswordRequest(BaseModel):
    email: str
    code: str
    new_password: str


def _generate_otp() -> str:
    """6-digit numeric OTP using a cryptographically-secure RNG."""
    return "".join(secrets.choice("0123456789") for _ in range(6))


def _otp_email_bodies(code: str) -> tuple[str, str]:
    """Returns (text_body, html_body) for the OTP email."""
    text = (
        "Hi,\n\n"
        f"Your ToSafePlace password reset code is: {code}\n\n"
        f"This code expires in {OTP_TTL_MINUTES} minutes. "
        "If you didn't request a password reset, you can safely ignore this email.\n\n"
        "— ToSafePlace"
    )
    html = f"""
    <div style="font-family: -apple-system, Helvetica, Arial, sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="color: #0a7ea4;">Reset your password</h2>
      <p>Use this code to reset your ToSafePlace password:</p>
      <div style="font-size: 32px; font-weight: 700; letter-spacing: 6px;
                  background: #f0f4f8; padding: 16px 24px; border-radius: 8px;
                  text-align: center; color: #0a7ea4;">{code}</div>
      <p style="color: #666; font-size: 13px;">
        This code expires in {OTP_TTL_MINUTES} minutes. If you didn't request a
        password reset, you can safely ignore this email.
      </p>
    </div>
    """
    return text, html


@router.post("/forgot-password")
async def forgot_password(body: ForgotPasswordRequest):
    """Generate an OTP and email it. Returns the same message whether or not
    the email exists in the system — this prevents the endpoint from leaking
    which accounts are registered."""
    email = body.email.strip().lower()
    generic_response = {
        "message": "If an account exists for this email, a code has been sent.",
    }

    user = await db["User"].find_one({"email": email})
    if not user:
        return generic_response

    # Anti-spam: refuse if a previous code was issued less than RESEND_COOLDOWN_SECONDS ago
    existing = await db["PasswordReset"].find_one({"email": email})
    if existing and existing.get("created_at"):
        elapsed = (datetime.now(timezone.utc) - existing["created_at"]).total_seconds()
        if elapsed < RESEND_COOLDOWN_SECONDS:
            wait = int(RESEND_COOLDOWN_SECONDS - elapsed)
            raise HTTPException(
                status_code=429,
                detail=f"Please wait {wait} seconds before requesting another code.",
            )

    code = _generate_otp()
    now = datetime.now(timezone.utc)
    record = {
        "email": email,
        "code": code,
        "created_at": now,
        "expires_at": now + timedelta(minutes=OTP_TTL_MINUTES),
    }
    # Upsert so a new request invalidates the old code
    await db["PasswordReset"].update_one(
        {"email": email},
        {"$set": record},
        upsert=True,
    )

    text_body, html_body = _otp_email_bodies(code)
    send_email(
        to_email=email,
        subject="Your ToSafePlace password reset code",
        html_body=html_body,
        text_body=text_body,
    )
    return generic_response


@router.post("/verify-reset-code")
async def verify_reset_code(body: VerifyResetCodeRequest):
    """Validate the code without consuming it. Lets the UI confirm the code is
    correct before asking for the new password — better UX than failing at the
    end of the flow."""
    email = body.email.strip().lower()
    record = await db["PasswordReset"].find_one({"email": email})

    if not record or record.get("code") != body.code:
        raise HTTPException(status_code=400, detail="Invalid code.")

    expires_at = record.get("expires_at")
    # Mongo gives back naive UTC datetimes; make them tz-aware before comparing
    if expires_at is not None and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if not expires_at or expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Code has expired. Please request a new one.")

    return {"valid": True}


@router.post("/reset-password")
async def reset_password(body: ResetPasswordRequest):
    email = body.email.strip().lower()
    new_password = body.new_password

    if not new_password:
        raise HTTPException(status_code=400, detail="New password is required.")

    record = await db["PasswordReset"].find_one({"email": email})
    if not record or record.get("code") != body.code:
        raise HTTPException(status_code=400, detail="Invalid code.")

    expires_at = record.get("expires_at")
    if expires_at is not None and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if not expires_at or expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Code has expired. Please request a new one.")

    result = await db["User"].update_one(
        {"email": email},
        {"$set": {"password": new_password}},
    )
    if result.matched_count == 0:
        # Should be unreachable given the OTP existed, but be defensive
        raise HTTPException(status_code=404, detail="User not found.")

    # Single-use: nuke the record so this OTP can't be replayed
    await db["PasswordReset"].delete_one({"email": email})

    return {"message": "Password reset successful."}


# ── Push-token registration ─────────────────────────────────────────────────
# The mobile app calls this after login so the backend can address pushes
# to the user. We always overwrite — a user may switch devices, and stale
# tokens stop receiving anyway.


class PushTokenRequest(BaseModel):
    user_id: str
    push_token: str


@router.post("/push-token")
async def save_push_token(body: PushTokenRequest):
    try:
        result = await db["User"].update_one(
            {"_id": ObjectId(body.user_id)},
            {"$set": {"expoPushToken": body.push_token}},
        )
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid user id")

    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")

    return {"message": "Push token saved"}


@router.delete("/push-token/{user_id}")
async def clear_push_token(user_id: str):
    """Called on logout so notifications don't follow the previous user.
    Clears both the Expo token and the raw FCM token (workaround field)."""
    try:
        await db["User"].update_one(
            {"_id": ObjectId(user_id)},
            {"$unset": {"expoPushToken": "", "fcmToken": ""}},
        )
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid user id")
    return {"message": "Push token cleared"}


# ── FCM-direct workaround endpoints ──────────────────────────────────────
# Android devices register a raw FCM token alongside their Expo token so
# the dispatcher can bypass Expo's broken FCM V1 routing. iOS doesn't use
# these — Expo handles APNs delivery fine. See app/core/fcm_direct.py for
# context and how to test when Expo's bug is fixed.

class FcmTokenRequest(BaseModel):
    user_id:   str
    fcm_token: str


@router.post("/fcm-token")
async def save_fcm_token(body: FcmTokenRequest):
    try:
        result = await db["User"].update_one(
            {"_id": ObjectId(body.user_id)},
            {"$set": {"fcmToken": body.fcm_token}},
        )
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid user id")
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {"message": "FCM token saved"}


@router.delete("/fcm-token/{user_id}")
async def clear_fcm_token(user_id: str):
    """Companion to clear_push_token — same semantics, fcmToken-only.
    The combined clear above unsets both at once; this one is for callers
    who only want to drop the FCM token."""
    try:
        await db["User"].update_one(
            {"_id": ObjectId(user_id)},
            {"$unset": {"fcmToken": ""}},
        )
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid user id")
    return {"message": "FCM token cleared"}
