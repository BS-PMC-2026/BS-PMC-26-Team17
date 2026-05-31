"""
Reservation TTL Sweeper
-----------------------

Background asyncio task that rolls back expired ShelterReservation rows so
the `reservedPlaces` counter on the corresponding ShelterTest document
decays back to reality.

Why a sweeper instead of a Mongo TTL index:
  Mongo TTL only deletes the row — it can't $inc the counter on a
  *different* collection (ShelterTest). To keep the two in sync we need
  application code, so the row stays around (with `rolledBack=true`) for
  audit and the counter ticks down by exactly the right amount.

Idempotency:
  The find-update is two steps, but we filter the find by
  `rolledBack: false` and flip the flag in the update. If two sweepers
  raced on the same row, the second would see no matching rows and skip.
"""

import asyncio
import logging
from datetime import datetime, timezone

from bson import ObjectId

from app.core.database import db

log = logging.getLogger(__name__)

# How often the sweeper scans for expired rows. Cheap to run frequently
# because the index on (expiresAt, rolledBack) makes the query trivial.
SWEEP_INTERVAL_SECONDS = 60


def _derive_is_full(actual: int, reserved: int, capacity: int) -> bool:
    if capacity <= 0:
        return False
    return (actual + reserved) >= capacity


async def sweep_once() -> int:
    """
    Roll back every expired reservation in a single pass.

    Returns the number of rows rolled back (handy for tests + log lines).
    Errors on individual rows are swallowed so one bad row never starves
    the rest of the batch.
    """
    now = datetime.now(timezone.utc)
    cursor = db["ShelterReservation"].find({
        "expiresAt":  {"$lt": now},
        "rolledBack": False,
    })

    rolled = 0
    async for row in cursor:
        try:
            # Atomically claim the row — only this sweeper run will see it
            # as not-rolled-back, so the $inc below runs at most once.
            claim = await db["ShelterReservation"].update_one(
                {"_id": row["_id"], "rolledBack": False},
                {"$set": {"rolledBack": True}},
            )
            if claim.modified_count == 0:
                continue  # another sweeper got there first

            group_size  = int(row.get("groupSize", 0) or 0)
            shelter_id  = row.get("shelterId")
            if not shelter_id or group_size <= 0:
                continue

            try:
                shelter_oid = ObjectId(shelter_id)
            except Exception:
                continue

            await db["ShelterTest"].update_one(
                {"_id": shelter_oid},
                {"$inc": {"reservedPlaces": -group_size}},
            )

            # Refresh and recompute isFull; only write when it flips, to
            # avoid spamming when neither side actually changed.
            shelter = await db["ShelterTest"].find_one({"_id": shelter_oid}) or {}
            capacity = int(shelter.get("capacity", 0) or 0)
            reserved = int(shelter.get("reservedPlaces", 0) or 0)
            actual   = int(shelter.get("actualOccupancy", 0) or 0)
            new_full = _derive_is_full(actual, reserved, capacity)
            if bool(shelter.get("isFull", False)) != new_full:
                await db["ShelterTest"].update_one(
                    {"_id": shelter_oid},
                    {"$set": {"isFull": new_full}},
                )

            rolled += 1
        except Exception as e:
            log.warning("[sweeper] failed to roll back %s: %s", row.get("_id"), e)

    if rolled:
        log.info("[sweeper] rolled back %d expired reservation(s)", rolled)
    return rolled


async def sweeper_loop(interval_seconds: int = SWEEP_INTERVAL_SECONDS) -> None:
    """Long-running task — call from the FastAPI startup hook."""
    log.info("[sweeper] starting (interval=%ss)", interval_seconds)
    while True:
        try:
            await sweep_once()
        except Exception as e:
            # Never let a sweep tick kill the loop.
            log.warning("[sweeper] tick failed: %s", e)
        await asyncio.sleep(interval_seconds)
