"""Home-radius geofence notifications.

The mobile app watches GPS while open and decides whether the user has
crossed in or out of their home exclusion radius. When a transition
happens, the client POSTs here and we push back to the user's device
through the same Expo Push pipeline used by admin/report alerts.

Server-side dedupe (lastGeofenceState on the user doc) means if the
client retries or fires duplicates, only the first one delivers a push.
"""
from typing import Literal

from bson import ObjectId
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.core.database import db
from app.routes.MessageAll.push import send_expo_push

router = APIRouter(prefix="/api/geofence", tags=["geofence"])


class GeofenceEvent(BaseModel):
    user_id: str
    event: Literal["exit", "enter"]


_COPY = {
    "exit": (
        "You left your safe zone",
        "You're outside your home radius — stay alert and know where the nearest shelter is.",
    ),
    "enter": (
        "You're back in your safe zone",
        "You've returned to within your home radius.",
    ),
}


@router.post("/event")
async def geofence_event(body: GeofenceEvent):
    try:
        user = await db["User"].find_one({"_id": ObjectId(body.user_id)})
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid user id")

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Dedupe — ignore a repeated event of the same kind. The very first
    # event after login (when lastGeofenceState is missing) is allowed
    # through so the user gets one initial notification.
    if user.get("lastGeofenceState") == body.event:
        return {"status": "duplicate", "sent": False}

    await db["User"].update_one(
        {"_id": ObjectId(body.user_id)},
        {"$set": {"lastGeofenceState": body.event}},
    )

    token = user.get("expoPushToken")
    if not token:
        return {"status": "no_token", "sent": False}

    title, message = _COPY[body.event]
    sent = await send_expo_push(
        [token],
        title,
        message,
        {"type": "geofence", "event": body.event},
    )
    return {"status": "ok" if sent else "push_failed", "sent": sent}
