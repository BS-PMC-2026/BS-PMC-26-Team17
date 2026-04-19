from fastapi import APIRouter, HTTPException
from app.models import UserSettings
import os

router = APIRouter()
db = {os.getenv("DATABASE_NAME")} # Replace with real database later

@router.post("/api/settings")
async def update_settings(settings: UserSettings):
    db[settings.user_id] = settings.dict()
    return {"status": "success", "message": "Settings updated"}

@router.get("/api/settings/{user_id}")
async def get_settings(user_id: str):
    if user_id in db:
        return db[user_id]
    raise HTTPException(status_code=404, detail="User settings not found")