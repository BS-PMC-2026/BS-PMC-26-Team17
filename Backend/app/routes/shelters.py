from fastapi import APIRouter, Query
from typing import Optional
from app.core.database import db

router = APIRouter(prefix="/shelters", tags=["shelters"])


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
    async for shelter in db["Shelters"].find(query, {"_id": 0}):
        shelters.append(shelter)

    return {"shelters": shelters, "count": len(shelters)}