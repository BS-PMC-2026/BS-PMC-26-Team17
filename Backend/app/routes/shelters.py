# from fastapi import APIRouter, Query, HTTPException
# from typing import Optional
# from pydantic import BaseModel
# from bson import ObjectId
# from app.core.database import db

# router = APIRouter(prefix="/shelters", tags=["ShelterTest"])


# async def _is_admin(user_id: str) -> bool:
#     if not user_id:
#         return False
#     try:
#         user = await db["User"].find_one({"_id": ObjectId(user_id)})
#     except Exception:
#         return False
#     return bool(user and user.get("role") == "admin")


# @router.get("")
# async def get_shelters(
#     city: Optional[str] = Query(None),
#     area: Optional[str] = Query(None),
#     status: Optional[str] = Query(None),
#     place_type: Optional[str] = Query(None),
#     search: Optional[str] = Query(None),
# ):
#     query = {}

#     if city:
#         query["city"] = city
#     if area:
#         query["alertZone"] = area
        
#     if place_type:
#         query["placeType"] = place_type
#     if status:
#         query["accessStatus"] = status
#     if search:
#         query["$or"] = [
#             {"name": {"$regex": search, "$options": "i"}},
#             {"address": {"$regex": search, "$options": "i"}},
#             {"neighborhood": {"$regex": search, "$options": "i"}},
#         ]

#     shelters = []
#     async for shelter in db["ShelterTest"].find(query).limit(300):
#         shelter["id"] = str(shelter["_id"])
#         del shelter["_id"]
#         shelters.append(shelter)

#     return {"shelters": shelters, "count": len(shelters)}


# class ShelterCreate(BaseModel):
#     user_id: str
#     name: str
#     address: str
#     neighborhood: str = ""
#     area: str = ""
#     city: str = "Be'er Sheva"
#     lat: float
#     lng: float
#     placeType: str = "public shelter"
#     capacity: int = 0
#     accessStatus: str = "open"
#     isAccessible: bool = False
#     isFull: bool = False
#     hasStairs: bool = False
#     petIssueReported: bool = False
#     cleanlinessStatus: str = "unknown"
#     shouldBeOpen: bool = True

# @router.post("")
# async def create_shelter(body: ShelterCreate):
#     if not await _is_admin(body.user_id):
#         raise HTTPException(status_code=403, detail="Admin access required")

#     data = body.model_dump()
#     data.pop("user_id")
#     result = await db["ShelterTest"].insert_one(data)
#     data["id"] = str(result.inserted_id)
#     return {"message": "Shelter added", "shelter": data}


# @router.delete("/{shelter_id}")
# async def delete_shelter(shelter_id: str, user_id: str = Query(...)):
#     if not await _is_admin(user_id):
#         raise HTTPException(status_code=403, detail="Admin access required")

#     try:
#         result = await db["ShelterTest"].delete_one({"_id": ObjectId(shelter_id)})
#     except Exception:
#         raise HTTPException(status_code=400, detail="Invalid shelter id")

#     if result.deleted_count == 0:
#         raise HTTPException(status_code=404, detail="Shelter not found")

#     return {"message": "Shelter deleted"}
from fastapi import APIRouter, Query, HTTPException
from typing import Optional
from pydantic import BaseModel
from bson import ObjectId
from app.core.database import db

router = APIRouter(prefix="/shelters", tags=["ShelterTest"])


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
    limit: int = Query(1000, ge=1, le=5000),
):
    query = {
        "lat": {"$exists": True, "$ne": None},
        "lng": {"$exists": True, "$ne": None},
    }

    if city:
        query["city"] = {"$regex": f"^{city}$", "$options": "i"}

    if area:
        query["alertZone"] = area

    if place_type:
        query["placeType"] = place_type

    if status:
        query["accessStatus"] = status

    if search:
        query["$or"] = [
            {"name": {"$regex": search, "$options": "i"}},
            {"address": {"$regex": search, "$options": "i"}},
            {"neighborhood": {"$regex": search, "$options": "i"}},
            {"alertZone": {"$regex": search, "$options": "i"}},
        ]

    shelters = []
    async for shelter in db["ShelterTest"].find(query).limit(limit):
        shelter["id"] = str(shelter["_id"])
        del shelter["_id"]

        shelter["lat"] = float(shelter["lat"])
        shelter["lng"] = float(shelter["lng"])

        shelters.append(shelter)

    return {
        "shelters": shelters,
        "count": len(shelters),
        "query": query,
    }


class ShelterCreate(BaseModel):
    user_id: str
    name: str
    address: str
    neighborhood: str = ""
    alertZone: str = ""
    city: str = "באר שבע"
    lat: float
    lng: float
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

    return {
        "message": "Shelter added",
        "shelter": data,
    }


class ShelterUpdate(BaseModel):
    user_id: str
    name: Optional[str] = None
    address: Optional[str] = None
    accessStatus: Optional[str] = None
    shouldBeOpen: Optional[bool] = None
    cleanlinessStatus: Optional[str] = None
    isAccessible: Optional[bool] = None
    hasStairs: Optional[bool] = None
    petIssueReported: Optional[bool] = None
    capacity: Optional[int] = None


@router.patch("/{shelter_id}")
async def update_shelter(shelter_id: str, body: ShelterUpdate):
    if not await _is_admin(body.user_id):
        raise HTTPException(status_code=403, detail="Admin access required")

    try:
        oid = ObjectId(shelter_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid shelter id")

    updates = {k: v for k, v in body.model_dump(exclude={"user_id"}).items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    result = await db["ShelterTest"].update_one({"_id": oid}, {"$set": updates})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Shelter not found")

    return {"message": "Shelter updated"}


@router.delete("/{shelter_id}")
async def delete_shelter(
    shelter_id: str,
    user_id: str = Query(...),
):
    if not await _is_admin(user_id):
        raise HTTPException(status_code=403, detail="Admin access required")

    try:
        object_id = ObjectId(shelter_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid shelter id")

    result = await db["ShelterTest"].delete_one({"_id": object_id})

    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Shelter not found")

    return {"message": "Shelter deleted"}


@router.get("/{shelter_id}/reports")
async def get_shelter_reports(shelter_id: str):
    try:
        ObjectId(shelter_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid shelter id")

    reports = []
    async for report in db["Report"].find({"shelterId": shelter_id}).sort("createdAt", -1):
        report["id"] = str(report["_id"])
        del report["_id"]
        reports.append(report)

    return {"reports": reports, "count": len(reports)}
