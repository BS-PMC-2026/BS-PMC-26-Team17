from fastapi import APIRouter, HTTPException
from bson import ObjectId
from app.core.database import db
from app.models import UserSettings

router = APIRouter()


@router.post("/api/settings")
async def update_settings(settings: UserSettings):
    update = {
        "address": settings.address or "",
        "homeLat": settings.home_lat,
        "homeLng": settings.home_lng,
        "exclusionRadius": settings.exclusion_radius,
        "mobilityType": settings.transport_mode,
        "isAccessible": settings.is_handicapped,
    }
    try:
        result = await db["User"].update_one(
            {"_id": ObjectId(settings.user_id)},
            {"$set": update},
        )
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid user id")

    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")

    return {"status": "success", "message": "Settings updated"}


@router.get("/api/settings/{user_id}")
async def get_settings(user_id: str):
    try:
        user = await db["User"].find_one({"_id": ObjectId(user_id)})
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid user id")

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    return {
        "address": user.get("address", ""),
        "home_lat": user.get("homeLat"),
        "home_lng": user.get("homeLng"),
        "exclusion_radius": user.get("exclusionRadius", 0.0),
        "transport_mode": user.get("mobilityType", "walking"),
        "is_handicapped": user.get("isAccessible", False),
    }
