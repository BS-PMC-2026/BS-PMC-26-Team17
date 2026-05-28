"""Admin broadcast — one message goes out to every user.

Two endpoints:
  POST /api/admin/broadcast  — admin sends; we persist to MongoDB AND
                               best-effort push to every registered token.
  GET  /api/broadcasts?after=&lt;iso-ts&gt;
                              — the mobile app polls this so even users in
                                Expo Go (where remote push isn't delivered)
                                can show a local notification for new
                                broadcasts. Pass `after` to receive only
                                broadcasts newer than the given timestamp.
"""
from datetime import datetime, timezone
from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.core.database import db
from app.routes.MessageAll.push import send_expo_push

router = APIRouter(tags=["broadcast"])

EXPO_BATCH_LIMIT = 100


class BroadcastCreate(BaseModel):
    admin_id: str
    title: str
    body: str


@router.post("/api/admin/broadcast")
async def create_broadcast(body: BroadcastCreate):
    # 1. Verify the sender is an admin
    try:
        admin = await db["User"].find_one({"_id": ObjectId(body.admin_id)})
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid admin id")
    if not admin:
        raise HTTPException(status_code=404, detail="Admin user not found")
    if admin.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Only admins can broadcast")

    # 2. Persist the broadcast so clients can pick it up via polling
    sent_at = datetime.now(timezone.utc)
    doc = {
        "title": body.title.strip(),
        "body": body.body.strip(),
        "senderId": str(admin["_id"]),
        "senderName": (
            f"{admin.get('firstName', '')} {admin.get('lastName', '')}".strip()
            or admin.get("email", "")
        ),
        "sentAt": sent_at,
    }
    result = await db["Broadcast"].insert_one(doc)
    broadcast_id = str(result.inserted_id)

    # 3. Best-effort Expo push to every user with a saved token
    tokens: list[str] = []
    async for user in db["User"].find(
        {"expoPushToken": {"$exists": True, "$ne": ""}}
    ):
        token = user.get("expoPushToken")
        if token:
            tokens.append(token)

    sent_count = 0
    if tokens:
        for i in range(0, len(tokens), EXPO_BATCH_LIMIT):
            batch = tokens[i : i + EXPO_BATCH_LIMIT]
            ok = await send_expo_push(
                batch,
                doc["title"],
                doc["body"],
                {"type": "broadcast", "broadcastId": broadcast_id},
            )
            if ok:
                sent_count += len(batch)

    return {
        "status": "ok",
        "broadcast_id": broadcast_id,
        "tokenCount": len(tokens),
        "pushedCount": sent_count,
    }


@router.get("/api/broadcasts")
async def list_broadcasts(after: Optional[str] = Query(None)):
    """Return broadcasts strictly newer than the `after` timestamp.

    `after` is an ISO-8601 string (e.g. "2026-05-27T10:30:00Z"). When
    omitted, returns the 20 most recent broadcasts — useful for an
    admin-side history view, not used by the polling client which always
    sends `after`.
    """
    query: dict = {}
    if after:
        try:
            cutoff = datetime.fromisoformat(after.replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid 'after' timestamp")
        query["sentAt"] = {"$gt": cutoff}

    cursor = db["Broadcast"].find(query).sort("sentAt", 1).limit(50)
    items = []
    async for b in cursor:
        items.append(
            {
                "id": str(b["_id"]),
                "title": b.get("title", ""),
                "body": b.get("body", ""),
                "senderName": b.get("senderName", ""),
                "sentAt": b["sentAt"].isoformat(),
            }
        )
    return {"items": items}
