from datetime import datetime, timezone
from math import radians, sin, cos, asin, sqrt
from fastapi import APIRouter, HTTPException
from bson import ObjectId
from app.core.database import db
from app.models import ReportCreate

router = APIRouter(prefix="/reports", tags=["reports"])

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


@router.post("")
async def create_report(body: ReportCreate):
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

    result = await db["Report"].insert_one(report)
    return {"message": "Report submitted successfully", "reportId": str(result.inserted_id)}


@router.get("")
async def get_reports():
    reports = []
    async for r in db["Report"].find().sort("createdAt", -1):
        r["_id"] = str(r["_id"])
        reports.append(r)
    return {"reports": reports, "count": len(reports)}
