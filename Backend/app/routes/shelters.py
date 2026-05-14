from fastapi import APIRouter, Query, HTTPException
from typing import Optional
from pydantic import BaseModel
from bson import ObjectId
from app.core.database import db

router = APIRouter(prefix="/shelters", tags=["shelters"])


async def _is_admin(user_id: str) -> bool:
    if not user_id:
        return False
    try:
        user = await db["User"].find_one({"_id": ObjectId(user_id)})
    except Exception:
        return False
    return bool(user and user.get("role") == "admin")


@router.get("")
async def get_shelters(
    city: Optional[str] = Query(None),
    area: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    place_type: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
):
    query = {}

    if city:
        query["city"] = city
    if area:
        query["area"] = area
    if place_type:
        query["placeType"] = place_type
    if status:
        query["accessStatus"] = status
    if search:
        query["$or"] = [
            {"name": {"$regex": search, "$options": "i"}},
            {"address": {"$regex": search, "$options": "i"}},
            {"neighborhood": {"$regex": search, "$options": "i"}},
        ]

    shelters = []
    async for shelter in db["ShelterTest"].find(query).limit(100):
        shelter["id"] = str(shelter["_id"])
        del shelter["_id"]
        shelters.append(shelter)

    return {"shelters": shelters, "count": len(shelters)}


class ShelterCreate(BaseModel):
    user_id: str
    name: str
    address: str
    neighborhood: str = ""
    area: str = ""
    city: str = "Be'er Sheva"
    placeType: str = "public shelter"
    capacity: int = 0
    accessStatus: str = "open"
    isAccessible: bool = False
    isFull: bool = False
    hasStairs: bool = False
    petIssueReported: bool = False
    cleanlinessStatus: str = "unknown"
    shouldBeOpen: bool = True


@router.post("")
async def create_shelter(body: ShelterCreate):
    if not await _is_admin(body.user_id):
        raise HTTPException(status_code=403, detail="Admin access required")

    data = body.model_dump()
    data.pop("user_id")
    result = await db["ShelterTest"].insert_one(data)
    data["id"] = str(result.inserted_id)
    return {"message": "Shelter added", "shelter": data}


@router.delete("/{shelter_id}")
async def delete_shelter(shelter_id: str, user_id: str = Query(...)):
    if not await _is_admin(user_id):
        raise HTTPException(status_code=403, detail="Admin access required")

    try:
        result = await db["ShelterTest"].delete_one({"_id": ObjectId(shelter_id)})
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid shelter id")

    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Shelter not found")

    return {"message": "Shelter deleted"}
