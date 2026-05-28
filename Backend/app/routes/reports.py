from datetime import datetime, timedelta, timezone
from math import radians, sin, cos, asin, sqrt
from typing import Optional
from fastapi import APIRouter, BackgroundTasks, HTTPException, Query
from pydantic import BaseModel
from bson import ObjectId
from app.core.database import db
from app.routes.MessageAll.push import send_expo_push
from app.models import ReportCreate

router = APIRouter(prefix="/reports", tags=["reports"])

# Urgent access reports (closed/locked) trigger a push to all admins. To avoid
# spamming when multiple users report the same shelter in quick succession,
# we coalesce: at most one notification per (shelter, type) per window.
# A "closed" and a "locked" report on the same shelter are treated as
# different events and each can fire once per window.
URGENT_COALESCE_MINUTES = 15
URGENT_REPORT_TYPES = {"closed", "locked"}


async def _is_admin(user_id: str) -> bool:
    if not user_id:
        return False
    try:
        user = await db["User"].find_one({"_id": ObjectId(user_id)})
    except Exception:
        return False
    return bool(user and user.get("role") == "admin")

# Distance (meters) within which a report is considered "verified"
VERIFY_RADIUS_METERS = 50


def _haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle distance between two coordinates, in meters."""
    R = 6371000  # Earth radius in meters
    lat1_r, lat2_r = radians(lat1), radians(lat2)
    dlat = radians(lat2 - lat1)
    dlng = radians(lng2 - lng1)
    a = sin(dlat / 2) ** 2 + cos(lat1_r) * cos(lat2_r) * sin(dlng / 2) ** 2
    return 2 * R * asin(sqrt(a))


async def _lookup_shelter_coords(shelter_id: str):
    """Return (lat, lng) for a shelter, or (None, None) if not found."""
    try:
        shelter = await db["ShelterTest"].find_one({"_id": ObjectId(shelter_id)})
    except Exception:
        return None, None
    if not shelter:
        return None, None
    lat = shelter.get("lat", shelter.get("latitude"))
    lng = shelter.get("lng", shelter.get("longitude"))
    return lat, lng


async def _lookup_user_phone(user_id: str) -> str:
    """Return the user's registered telephone, or empty string."""
    if not user_id:
        return ""
    try:
        user = await db["User"].find_one({"_id": ObjectId(user_id)})
    except Exception:
        return ""
    return (user or {}).get("telephone", "") or ""


async def _lookup_shelter_name(shelter_id: str) -> str:
    try:
        shelter = await db["ShelterTest"].find_one({"_id": ObjectId(shelter_id)})
    except Exception:
        return ""
    return (shelter or {}).get("name", "") or ""


def _urgent_copy(report_type: str, shelter_name: str) -> tuple[str, str]:
    """Notification title + body for a given urgent report type."""
    if report_type == "closed":
        title = "Closed shelter reported"
        action = "is closed"
    elif report_type == "locked":
        title = "Locked shelter reported"
        action = "is locked"
    else:
        title = "Shelter issue reported"
        action = f"has a {report_type} issue"

    body = (
        f"A user reported that {shelter_name} {action}."
        if shelter_name
        else f"A user reported that a shelter {action}."
    )
    return title, body


async def _notify_admins_urgent_report(
    shelter_id: str,
    report_type: str,
    report_id: str,
) -> None:
    """Background task: push an alert to every admin with a registered token.

    Coalesced per (shelter_id, report_type) within URGENT_COALESCE_MINUTES, so
    multiple users reporting the same shelter back-to-back yield at most one
    notification per type. A closed report and a locked report on the same
    shelter are treated independently and can both fire.
    """
    # Coalesce check — skip if we already notified for this shelter+type recently
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=URGENT_COALESCE_MINUTES)
    recent = await db["NotificationLog"].find_one(
        {
            "shelterId": shelter_id,
            "type": report_type,
            "sentAt": {"$gte": cutoff},
        }
    )
    if recent:
        return

    # Gather every admin's push token
    tokens: list[str] = []
    async for admin in db["User"].find(
        {"role": "admin", "expoPushToken": {"$exists": True, "$ne": ""}}
    ):
        token = admin.get("expoPushToken")
        if token:
            tokens.append(token)

    if not tokens:
        return

    shelter_name = await _lookup_shelter_name(shelter_id)
    title, body = _urgent_copy(report_type, shelter_name)
    data = {
        "type": report_type,
        "shelterId": shelter_id,
        "reportId": report_id,
    }

    sent = await send_expo_push(tokens, title, body, data)
    # Record only on successful send so a transient failure doesn't suppress
    # follow-up notifications for the next 15 minutes
    if sent:
        await db["NotificationLog"].insert_one(
            {
                "shelterId": shelter_id,
                "type": report_type,
                "sentAt": datetime.now(timezone.utc),
                "recipientCount": len(tokens),
                "reportId": report_id,
            }
        )


@router.post("")
async def create_report(body: ReportCreate, background_tasks: BackgroundTasks):
    count = await db["Report"].count_documents({})

    # Always pull reporterNumber from the User table — frontend may have stale data
    reporter_number = await _lookup_user_phone(body.userId)
    # Fall back to what the client sent if DB lookup turned up nothing
    if not reporter_number:
        reporter_number = body.reporterNumber or ""

    # Compute isVerified: reporter must be within VERIFY_RADIUS_METERS of the shelter
    is_verified = False
    if body.reporterLat is not None and body.reporterLng is not None:
        shelter_lat, shelter_lng = await _lookup_shelter_coords(body.shelterId)
        if isinstance(shelter_lat, (int, float)) and isinstance(shelter_lng, (int, float)):
            distance = _haversine_m(
                float(body.reporterLat),
                float(body.reporterLng),
                float(shelter_lat),
                float(shelter_lng),
            )
            is_verified = distance <= VERIFY_RADIUS_METERS

    report = {
        "number": count + 1,
        "shelterId": body.shelterId,
        "userId": body.userId,
        "reportCategory": body.reportCategory,
        "reportType": body.reportType,
        "description": body.description or "",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "forwardedAt": None,
        "status": "pending",
        "resolvedAt": None,
        "handledBy": None,
        "reporterLat": body.reporterLat,
        "reporterLng": body.reporterLng,
        "reporterNumber": reporter_number,
        "callbackNumber": body.callbackNumber or "",
        "isVerified": is_verified,
    }

    if body.reportType == "locked" and not is_verified:
        raise HTTPException(
            status_code=400,
            detail="You must be near the shelter to report it as locked",
        )

    result = await db["Report"].insert_one(report)
    report_id = str(result.inserted_id)

    # Fan out a push to all admins on urgent access reports (closed/locked).
    # Runs after the response is returned so the user never waits on Expo's servers.
    # Locked reports are guaranteed verified by the check above; closed reports
    # may be unverified but still notify (the manager sees `isVerified` in the
    # report record and can prioritize accordingly).
    if (
        body.reportCategory == "access"
        and body.reportType in URGENT_REPORT_TYPES
    ):
        background_tasks.add_task(
            _notify_admins_urgent_report,
            body.shelterId,
            body.reportType,
            report_id,
        )

    return {"message": "Report submitted successfully", "reportId": report_id}


@router.get("")
async def get_reports(shelterId: Optional[str] = Query(None)):
    query: dict = {}
    if shelterId:
        query["shelterId"] = shelterId
    reports = []
    async for r in db["Report"].find(query).sort("createdAt", -1):
        r["id"] = str(r["_id"])
        del r["_id"]
        reports.append(r)
    return {"reports": reports, "count": len(reports)}


class ReportUpdate(BaseModel):
    user_id: str
    status: Optional[str] = None
    forwardedAt: Optional[str] = None
    resolvedAt: Optional[str] = None
    handledBy: Optional[str] = None


@router.patch("/{report_id}")
async def update_report(report_id: str, body: ReportUpdate):
    if not await _is_admin(body.user_id):
        raise HTTPException(status_code=403, detail="Admin access required")

    try:
        oid = ObjectId(report_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid report id")

    updates = {k: v for k, v in body.model_dump(exclude={"user_id"}).items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    result = await db["Report"].update_one({"_id": oid}, {"$set": updates})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Report not found")

    return {"message": "Report updated"}
