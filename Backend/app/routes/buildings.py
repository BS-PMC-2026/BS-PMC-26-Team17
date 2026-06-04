"""Building Manager Registration (BSPMT17-371 / 374).

A building manager registers their building by creating a new shelter document
in the existing ``ShelterTest`` collection. The new doc is marked
``isActive: False`` / ``isVisibleOnMap: False`` so it is hidden from the map
until an admin approves it via the existing Shelter Dashboard.

Auth pattern follows ``reports.py``: ``user_id`` is passed explicitly in the
body / path, no FastAPI ``Depends`` is used.
"""
import base64
import re
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import quote

from bson import ObjectId
from fastapi import APIRouter, HTTPException, Query, Response
from pydantic import BaseModel

from app.core.database import db
from app.routes.MessageAll.push import send_expo_push

router = APIRouter(prefix="/buildings", tags=["buildings"])


async def _is_admin(user_id: str) -> bool:
    if not user_id:
        return False
    try:
        user = await db["User"].find_one({"_id": ObjectId(user_id)})
    except Exception:
        return False
    return bool(user and user.get("role") == "admin")


class BuildingRegistrationRequest(BaseModel):
    user_id: str
    address: str
    lat: float
    lng: float
    city: Optional[str] = None
    neighborhood: Optional[str] = None
    alertZone: Optional[str] = None
    apartmentCount: int
    shelterLocation: str
    entranceCode: Optional[str] = None
    fileBase64: Optional[str] = None
    fileName: Optional[str] = None


def _serialize(doc: dict) -> dict:
    out = dict(doc)
    out["id"] = str(out.pop("_id"))
    return out


def _address_dup_filter(address: str, city: str) -> dict:
    """Mongo filter for an active (non-cancelled) registration at this address.

    Address + city are matched case- and whitespace-insensitively. Cancelled
    registrations don't count — that slot is free again.
    """
    addr_pattern = re.escape(address.strip())
    city_pattern = re.escape((city or "").strip())
    return {
        "managerUserId": {"$exists": True},
        "registrationStatus": {"$in": ["pending", "approved"]},
        "address": {"$regex": f"^{addr_pattern}$", "$options": "i"},
        "city": {"$regex": f"^{city_pattern}$", "$options": "i"},
    }


@router.post("/register")
async def register_building(body: BuildingRegistrationRequest):
    existing = await db["ShelterTest"].find_one(
        {
            "managerUserId": body.user_id,
            "registrationStatus": {"$ne": "cancelled"},
        }
    )
    if existing:
        raise HTTPException(
            status_code=400,
            detail="You already have an active building registration",
        )

    # Same-address duplicate (different user). Defense in depth — the
    # frontend also checks this proactively to warn the user before submit.
    full_address = (
        f"{body.address}".strip()  # already includes house number from frontend
    )
    dup = await db["ShelterTest"].find_one(
        _address_dup_filter(full_address, body.city or "")
    )
    if dup:
        raise HTTPException(
            status_code=409,
            detail="A building registration already exists for this address.",
        )

    # Confirm the user lives at the address they are trying to register.
    # Lenient match: every non-trivial token of the building address (street
    # name parts + house number) must appear in the user's profile address.
    # That way "65 רוטנברג" matches "רוטנברג 65, באר שבע" regardless of
    # ordering or whether a city is appended.
    user = await db["User"].find_one({"_id": ObjectId(body.user_id)})
    user_address = (user.get("address") or "").strip().lower() if user else ""
    building_tokens = [
        t for t in body.address.strip().lower().replace(",", " ").split()
        if len(t) >= 2
    ]
    if not user_address or not all(t in user_address for t in building_tokens):
        raise HTTPException(
            status_code=400,
            detail=(
                "You can only register a building where you live. "
                f"Your profile address is '{user_address}', "
                f"building address is '{body.address}'."
            ),
        )

    shelter_name = f"{body.address} - {body.shelterLocation}".strip(" -")
    estimated_capacity = (body.apartmentCount or 0) * 3

    doc = {
        # Real ShelterTest schema fields (matches existing shelters)
        "name": shelter_name,
        "lat": body.lat,
        "lng": body.lng,
        "address": body.address,
        "city": body.city or "",
        "neighborhood": body.neighborhood or "",
        "alertZone": body.alertZone or "",
        "placeType": "underground",
        "capacity": estimated_capacity,
        "demographicPotential": estimated_capacity,
        "isAccessible": False,
        "hasStairs": False,
        "accessStatus": "unknown",
        "isFull": False,
        "shouldBeOpen": True,
        "petIssueReported": False,
        "cleanlinessStatus": "unknown",
        "lastReportType": "",
        "lastReportAt": datetime(1970, 1, 1, tzinfo=timezone.utc),
        "reservedPlaces": 0,
        "actualOccupancy": 0,
        "entranceCode": body.entranceCode or "",
        "isArnonaDiscount": False,
        "isActive": False,         # hidden until admin approves
        "isVisibleOnMap": False,
        # Building-registration-specific fields (new)
        "managerUserId": body.user_id,
        "apartmentCount": body.apartmentCount,
        "shelterLocation": body.shelterLocation,
        "registrationStatus": "pending",
        "registrationFileBase64": body.fileBase64,
        "registrationFileName": body.fileName,
        "registeredAt": datetime.now(timezone.utc).isoformat(),
    }

    result = await db["ShelterTest"].insert_one(doc)
    return {"id": str(result.inserted_id), "message": "Building registered"}


@router.get("/check")
async def check_address(address: str, city: str = ""):
    """Pre-submission lookup: does an active registration exist at this address?"""
    doc = await db["ShelterTest"].find_one(_address_dup_filter(address, city))
    return {
        "exists": bool(doc),
        "status": doc.get("registrationStatus") if doc else None,
    }


@router.get("/approved")
async def list_approved_buildings(lat: Optional[float] = Query(None), lng: Optional[float] = Query(None)):
    """Return all approved buildings with their entrance codes."""
    cursor = db["ShelterTest"].find({"registrationStatus": "approved"})
    buildings = []
    async for doc in cursor:
        buildings.append({
            "id":           str(doc["_id"]),
            "address":      doc.get("address", ""),
            "entranceCode": doc.get("entranceCode", ""),
            "lat":          doc.get("lat"),
            "lng":          doc.get("lng"),
        })
    return {"buildings": buildings}


@router.get("/my/{user_id}")
async def get_my_registration(user_id: str):
    doc = await db["ShelterTest"].find_one(
        {
            "managerUserId": user_id,
            "registrationStatus": {"$ne": "cancelled"},
        }
    )
    if not doc:
        return {"registration": None}
    doc.pop("registrationFileBase64", None)
    return {"registration": _serialize(doc)}


class CancelRegistrationRequest(BaseModel):
    user_id: str
    reason: Optional[str] = None


@router.post("/{registration_id}/cancel")
async def cancel_registration(registration_id: str, body: CancelRegistrationRequest):
    try:
        oid = ObjectId(registration_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid registration id")

    doc = await db["ShelterTest"].find_one({"_id": oid})
    if not doc:
        raise HTTPException(status_code=404, detail="Registration not found")
    if doc.get("managerUserId") != body.user_id:
        raise HTTPException(status_code=403, detail="Not your registration")

    await db["ShelterTest"].update_one(
        {"_id": oid},
        {
            "$set": {
                "registrationStatus": "cancelled",
                "isActive": False,
                "isVisibleOnMap": False,
                "cancelReason": (body.reason or "").strip(),
                "cancelledAt": datetime.now(timezone.utc).isoformat(),
            }
        },
    )
    return {"message": "Registration cancelled", "id": registration_id}


@router.get("")
async def list_buildings(user_id: str = Query(...)):
    """Admin: return all building registrations (docs with registrationStatus)."""
    if not await _is_admin(user_id):
        raise HTTPException(status_code=403, detail="Admin access required")

    cursor = db["ShelterTest"].find({"registrationStatus": {"$exists": True}})
    buildings = []
    async for doc in cursor:
        manager_id   = doc.get("managerUserId", "")
        manager_name = ""
        if manager_id:
            try:
                manager = await db["User"].find_one({"_id": ObjectId(manager_id)})
                if manager:
                    first = manager.get("firstName", "")
                    last  = manager.get("lastName", "")
                    manager_name = f"{first} {last}".strip()
            except Exception:
                pass

        buildings.append({
            "id":                     str(doc["_id"]),
            "address":                doc.get("address", ""),
            "city":                   doc.get("city", ""),
            "registrationStatus":     doc.get("registrationStatus", "pending"),
            "entranceCode":           doc.get("entranceCode", ""),
            "managerUserId":          manager_id,
            "managerName":            manager_name,
            "registrationFileName":   doc.get("registrationFileName"),
            # The base64 blob is intentionally NOT included here — list
            # responses stay small. Use GET /buildings/{id}/file to fetch.
            "hasFile":                bool(doc.get("registrationFileBase64")),
        })
    return {"buildings": buildings}


@router.get("/{registration_id}/file")
async def get_registration_file(
    registration_id: str,
    user_id: str = Query(...),
):
    """Admin-only: stream the uploaded permit/document so the dashboard
    can hand the URL to Linking.openURL (iOS Safari / Android viewer
    will render PDFs natively).
    """
    if not await _is_admin(user_id):
        raise HTTPException(status_code=403, detail="Admin access required")
    try:
        oid = ObjectId(registration_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid id")

    doc = await db["ShelterTest"].find_one({"_id": oid})
    if not doc or not doc.get("registrationFileBase64"):
        raise HTTPException(status_code=404, detail="File not found")

    b64_str = doc["registrationFileBase64"] or ""
    # Some clients add whitespace / data-url prefix that breaks decode.
    # Strip both defensively so the decode never fails.
    if "," in b64_str and b64_str.lstrip().startswith("data:"):
        b64_str = b64_str.split(",", 1)[1]
    b64_str = "".join(b64_str.split())  # remove all whitespace
    try:
        raw = base64.b64decode(b64_str, validate=False)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not decode file: {e}")

    name = doc.get("registrationFileName") or "document"
    # Diagnostic: confirm we got real binary out and the magic bytes match.
    head = raw[:8]
    print(
        f"[buildings/file] id={registration_id} "
        f"b64_len={len(b64_str)} bytes={len(raw)} "
        f"name={name!r} head={head!r}"
    )
    ext = (name.rsplit(".", 1)[-1] if "." in name else "").lower()
    ctype = {
        "pdf":  "application/pdf",
        "png":  "image/png",
        "jpg":  "image/jpeg",
        "jpeg": "image/jpeg",
    }.get(ext, "application/octet-stream")

    # HTTP headers must be latin-1. Hebrew (or any non-ASCII) filenames need
    # RFC 5987 encoding. We send both an ASCII-safe `filename=` and the
    # percent-encoded UTF-8 `filename*=` so all clients pick the right one.
    from urllib.parse import quote
    ascii_name = name.encode("ascii", "ignore").decode("ascii") or "document"
    if "." in name and "." not in ascii_name:
        ascii_name = f"document.{ext}" if ext else "document"
    content_disposition = (
        f'inline; filename="{ascii_name}"; '
        f"filename*=UTF-8''{quote(name)}"
    )
    return Response(
        content=raw,
        media_type=ctype,
        headers={"Content-Disposition": content_disposition},
    )


class ApproveRequest(BaseModel):
    user_id: str


@router.patch("/{registration_id}/approve")
async def approve_building(registration_id: str, body: ApproveRequest):
    """Admin: approve a pending building registration."""
    if not await _is_admin(body.user_id):
        raise HTTPException(status_code=403, detail="Admin access required")

    try:
        oid = ObjectId(registration_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid registration id")

    doc = await db["ShelterTest"].find_one({"_id": oid})
    if not doc:
        raise HTTPException(status_code=404, detail="Building registration not found")
    if doc.get("registrationStatus") == "approved":
        raise HTTPException(status_code=409, detail="Already approved")

    await db["ShelterTest"].update_one(
        {"_id": oid},
        {
            "$set": {
                "registrationStatus": "approved",
                "isActive":           True,
                "isVisibleOnMap":     False,  # stays hidden from public map
                "approvedAt":         datetime.now(timezone.utc).isoformat(),
                "approvedBy":         body.user_id,
            }
        },
    )

    # Send push notification to the building manager (best-effort).
    manager_id = doc.get("managerUserId")
    if manager_id:
        try:
            manager = await db["User"].find_one({"_id": ObjectId(manager_id)})
            token = manager.get("expoPushToken") if manager else None
            if token:
                await send_expo_push(
                    tokens=[token],
                    title="Building Registration Approved ✅",
                    body=(
                        f"Your building at {doc.get('address', 'your address')} "
                        "has been approved by an admin."
                    ),
                    data={"type": "building_approved", "buildingId": registration_id},
                )
        except Exception as e:
            print(f"[buildings] push notification failed: {e}")

    return {"message": "Building approved", "id": registration_id}


@router.patch("/{registration_id}/reject")
async def reject_building(registration_id: str, body: ApproveRequest):
    """Admin: reject a pending building registration."""
    if not await _is_admin(body.user_id):
        raise HTTPException(status_code=403, detail="Admin access required")

    try:
        oid = ObjectId(registration_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid registration id")

    doc = await db["ShelterTest"].find_one({"_id": oid})
    if not doc:
        raise HTTPException(status_code=404, detail="Building registration not found")
    if doc.get("registrationStatus") == "rejected":
        raise HTTPException(status_code=409, detail="Already rejected")

    await db["ShelterTest"].update_one(
        {"_id": oid},
        {
            "$set": {
                "registrationStatus": "rejected",
                "isActive":           False,
                "isVisibleOnMap":     False,
                "rejectedAt":         datetime.now(timezone.utc).isoformat(),
                "rejectedBy":         body.user_id,
            }
        },
    )

    # Send push notification to the building manager (best-effort).
    manager_id = doc.get("managerUserId")
    if manager_id:
        try:
            manager = await db["User"].find_one({"_id": ObjectId(manager_id)})
            token = manager.get("expoPushToken") if manager else None
            if token:
                await send_expo_push(
                    tokens=[token],
                    title="Building Registration Rejected ❌",
                    body="Your building registration request has been rejected. Please contact the admin for more information.",
                    data={"type": "building_rejected", "buildingId": registration_id},
                )
        except Exception as e:
            print(f"[buildings] push notification failed: {e}")

    return {"message": "Building rejected", "id": registration_id}
