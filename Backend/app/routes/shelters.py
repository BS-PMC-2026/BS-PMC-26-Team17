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
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Query, HTTPException
from typing import Optional
from pydantic import BaseModel, Field
from bson import ObjectId
from app.core.database import db

router = APIRouter(prefix="/shelters", tags=["ShelterTest"])

# Reservations from a Pikud HaOref alert expire after this window; the
# decay sweeper (app/core/reservations.py) rolls them back. Tuned to the
# rough lifetime of an active alert event.
RESERVATION_TTL_MINUTES = 30
# After a user arrives at the shelter, they stay counted in
# actualOccupancy for this long. Matches the reservation window so the
# accounting feels symmetric — adjust independently if needed.
ARRIVED_TTL_MINUTES = 30


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


class ShelterReserveBody(BaseModel):
    """Body for POST /shelters/{id}/reserve."""
    user_id:     str
    alert_id:    str
    alert_kind:  str = "siren"          # "early" | "siren"
    group_size:  int = Field(..., ge=1, le=20)


def _derive_is_full(actual: int, reserved: int, capacity: int) -> bool:
    """Shelter is full once committed + intended people meet capacity."""
    if capacity <= 0:
        return False
    return (actual + reserved) >= capacity


@router.post("/{shelter_id}/reserve")
async def reserve_shelter(shelter_id: str, body: ShelterReserveBody):
    """
    Upsert a ShelterReservation for (user_id, shelter_id, alert_id) and
    adjust the shelter's `reservedPlaces` counter by the delta.

    - New row → insert + $inc reservedPlaces by +group_size
    - Existing & not rolled-back → $inc reservedPlaces by (new − old)
    - Existing & already rolled-back → treat as new (insert a fresh row)

    Always returns the post-update state so the client can recolor the
    map marker without re-fetching.
    """
    try:
        shelter_oid = ObjectId(shelter_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid shelter id")

    shelter = await db["ShelterTest"].find_one({"_id": shelter_oid})
    if not shelter:
        raise HTTPException(status_code=404, detail="Shelter not found")

    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(minutes=RESERVATION_TTL_MINUTES)

    # Look for an active (non-rolled-back) reservation matching this
    # (user, shelter, alert). If found, compute the delta; if not, insert.
    existing = await db["ShelterReservation"].find_one({
        "userId":     body.user_id,
        "shelterId":  shelter_id,
        "alertId":    body.alert_id,
        "rolledBack": False,
    })

    if existing:
        delta = body.group_size - int(existing.get("groupSize", 0))
        reservation_id = str(existing["_id"])
        if delta != 0:
            await db["ShelterReservation"].update_one(
                {"_id": existing["_id"]},
                {"$set": {"groupSize": body.group_size, "expiresAt": expires_at}},
            )
        else:
            # No counter change, but still extend the TTL — the user is
            # showing intent again, so push back the rollback clock.
            await db["ShelterReservation"].update_one(
                {"_id": existing["_id"]},
                {"$set": {"expiresAt": expires_at}},
            )
    else:
        insert = await db["ShelterReservation"].insert_one({
            "userId":     body.user_id,
            "shelterId":  shelter_id,
            "alertId":    body.alert_id,
            "alertKind":  body.alert_kind,
            "groupSize":  body.group_size,
            "createdAt":  now,
            "expiresAt":  expires_at,
            "rolledBack": False,
        })
        reservation_id = str(insert.inserted_id)
        delta = body.group_size

    if delta != 0:
        await db["ShelterTest"].update_one(
            {"_id": shelter_oid},
            {"$inc": {"reservedPlaces": delta}},
        )

    # Re-read for the post-update counters, then recompute isFull.
    shelter = await db["ShelterTest"].find_one({"_id": shelter_oid}) or {}
    capacity = int(shelter.get("capacity", 0) or 0)
    reserved = int(shelter.get("reservedPlaces", 0) or 0)
    actual   = int(shelter.get("actualOccupancy", 0) or 0)
    is_full  = _derive_is_full(actual, reserved, capacity)

    # Only write isFull when it actually changed — avoids spamming writes.
    if bool(shelter.get("isFull", False)) != is_full:
        await db["ShelterTest"].update_one(
            {"_id": shelter_oid},
            {"$set": {"isFull": is_full}},
        )

    return {
        "reservation_id": reservation_id,
        "shelter_id":     shelter_id,
        "reservedPlaces": reserved,
        "actualOccupancy": actual,
        "capacity":       capacity,
        "isFull":         is_full,
        "expiresAt":      expires_at.isoformat(),
    }


class ShelterReleaseBody(BaseModel):
    """Body for POST /shelters/{id}/release."""
    user_id:  str
    alert_id: str


@router.post("/{shelter_id}/release")
async def release_shelter(shelter_id: str, body: ShelterReleaseBody):
    """
    Cancel an active (not-yet-arrived) reservation, decrementing the
    shelter's `reservedPlaces` by the reservation's groupSize. Used when
    the user backs out of /navigate — we don't want them counted for the
    full 30-minute TTL window if they're not actually going anymore.

    Arrived reservations are NOT affected — the user is physically there,
    so unmount-style triggers shouldn't undo their presence.

    Idempotent: if there's no active reservation, returns the shelter's
    current state without changing anything (and a 200, not 404 — the
    desired post-state is the same either way).
    """
    try:
        shelter_oid = ObjectId(shelter_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid shelter id")

    shelter = await db["ShelterTest"].find_one({"_id": shelter_oid})
    if not shelter:
        raise HTTPException(status_code=404, detail="Shelter not found")

    # Atomically claim the row — filter excludes arrived rows so /release
    # can never undo a real arrival, and `rolledBack: false` prevents a
    # double-decrement race with the sweeper or a concurrent release.
    existing = await db["ShelterReservation"].find_one_and_update(
        {
            "userId":     body.user_id,
            "shelterId":  shelter_id,
            "alertId":    body.alert_id,
            "rolledBack": False,
            "arrived":    {"$ne": True},
        },
        {"$set": {"rolledBack": True}},
    )

    released = False
    if existing:
        group_size = int(existing.get("groupSize", 0) or 0)
        if group_size > 0:
            await db["ShelterTest"].update_one(
                {"_id": shelter_oid},
                {"$inc": {"reservedPlaces": -group_size}},
            )
            released = True

    # Re-read for the post-update counters, then recompute isFull.
    shelter = await db["ShelterTest"].find_one({"_id": shelter_oid}) or {}
    capacity = int(shelter.get("capacity", 0) or 0)
    reserved = int(shelter.get("reservedPlaces", 0) or 0)
    actual   = int(shelter.get("actualOccupancy", 0) or 0)
    is_full  = _derive_is_full(actual, reserved, capacity)
    if bool(shelter.get("isFull", False)) != is_full:
        await db["ShelterTest"].update_one(
            {"_id": shelter_oid},
            {"$set": {"isFull": is_full}},
        )

    return {
        "shelter_id":      shelter_id,
        "released":        released,
        "reservedPlaces":  reserved,
        "actualOccupancy": actual,
        "capacity":        capacity,
        "isFull":          is_full,
    }


class ShelterArriveBody(BaseModel):
    """Body for POST /shelters/{id}/arrive."""
    user_id:  str
    alert_id: str


@router.post("/{shelter_id}/arrive")
async def arrive_at_shelter(shelter_id: str, body: ShelterArriveBody):
    """
    Promote an active reservation from "reserved" → "arrived" once the
    user is physically at the shelter (within 10m, judged client-side).

    Counter effects:
      - reservedPlaces -= groupSize
      - actualOccupancy += groupSize
    plus on the reservation row: arrived=True, arrivedAt=now, and
    expiresAt is extended by ARRIVED_TTL_MINUTES so the sweeper doesn't
    immediately decrement actualOccupancy.

    Idempotent: if there's no active reservation (already arrived,
    rolled back, or never existed), returns the shelter's current
    state without changing anything.
    """
    try:
        shelter_oid = ObjectId(shelter_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid shelter id")

    shelter = await db["ShelterTest"].find_one({"_id": shelter_oid})
    if not shelter:
        raise HTTPException(status_code=404, detail="Shelter not found")

    now = datetime.now(timezone.utc)
    arrived_expires_at = now + timedelta(minutes=ARRIVED_TTL_MINUTES)

    # Atomic claim — only flips to arrived if the row exists, is active
    # (not rolled back), and hasn't already arrived. This prevents
    # double-promotion if the geofence trips twice in rapid succession.
    existing = await db["ShelterReservation"].find_one_and_update(
        {
            "userId":     body.user_id,
            "shelterId":  shelter_id,
            "alertId":    body.alert_id,
            "rolledBack": False,
            "arrived":    {"$ne": True},
        },
        {"$set": {
            "arrived":   True,
            "arrivedAt": now,
            "expiresAt": arrived_expires_at,
        }},
    )

    promoted = False
    if existing:
        group_size = int(existing.get("groupSize", 0) or 0)
        if group_size > 0:
            await db["ShelterTest"].update_one(
                {"_id": shelter_oid},
                {"$inc": {
                    "reservedPlaces":  -group_size,
                    "actualOccupancy": +group_size,
                }},
            )
            promoted = True

    # Re-read for post-update counters, then recompute isFull.
    shelter = await db["ShelterTest"].find_one({"_id": shelter_oid}) or {}
    capacity = int(shelter.get("capacity", 0) or 0)
    reserved = int(shelter.get("reservedPlaces", 0) or 0)
    actual   = int(shelter.get("actualOccupancy", 0) or 0)
    is_full  = _derive_is_full(actual, reserved, capacity)
    if bool(shelter.get("isFull", False)) != is_full:
        await db["ShelterTest"].update_one(
            {"_id": shelter_oid},
            {"$set": {"isFull": is_full}},
        )

    return {
        "shelter_id":      shelter_id,
        "promoted":        promoted,
        "reservedPlaces":  reserved,
        "actualOccupancy": actual,
        "capacity":        capacity,
        "isFull":          is_full,
    }


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
