import asyncio
from fastapi import APIRouter

router = APIRouter(prefix="/admin", tags=["admin"])


@router.post("/sync-shelters")
async def sync_shelters():
    """
    Fetch shelters from data.gov.il and upsert into ShelterTest collection.
    Safe: never touches the existing Shelters collection.
    """
    from sync.sync_shelters import run_sync
    result = await asyncio.to_thread(run_sync)
    return {"status": "done", **result}
