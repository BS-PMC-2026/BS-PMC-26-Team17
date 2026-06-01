"""
Reservation TTL Sweeper
-----------------------

Background asyncio task that decays expired ShelterReservation rows in two
phases, keeping the shelter's reservedPlaces / actualOccupancy honest:

  • Reserved-but-not-arrived rows:   after RESERVATION_TTL_MINUTES,
    decrement `reservedPlaces` by `groupSize`.
  • Arrived rows:                    after ARRIVED_TTL_MINUTES from arrival,
    decrement `actualOccupancy` by `groupSize`. Users have presumably
    left the shelter by then.

Why a sweeper instead of a Mongo TTL index:
  Mongo TTL only deletes the row — it can't $inc the counter on a
  *different* collection (ShelterTest). To keep the two in sync we need
  application code, so the row stays around (with `rolledBack=true`) for
  audit and the counter ticks down by exactly the right amount.

Idempotency:
  Atomic find_one_and_update with a filter on `rolledBack: false` ensures
  a row is decremented at most once even if two sweepers raced.
"""

import asyncio
import logging
from datetime import datetime, timezone

from bson import ObjectId
from pymongo.errors import (
    AutoReconnect, ConnectionFailure, NetworkTimeout, ServerSelectionTimeoutError,
)

from app.core.database import db

log = logging.getLogger(__name__)

# How often the sweeper scans for expired rows. Cheap to run frequently
# because the index on (expiresAt, rolledBack) makes the query trivial.
SWEEP_INTERVAL_SECONDS = 60

# Cap the connection-error backoff at this many sweep intervals so we don't
# stop checking entirely if the network is out for a long time.
MAX_BACKOFF_TICKS = 5

# Transient Mongo errors we should log quietly and back off on — most
# commonly hit when a laptop briefly loses DNS or the cluster is unreachable.
_NETWORK_ERRORS = (
    AutoReconnect,
    ConnectionFailure,
    NetworkTimeout,
    ServerSelectionTimeoutError,
)


def _derive_is_full(actual: int, reserved: int, capacity: int) -> bool:
    if capacity <= 0:
        return False
    return (actual + reserved) >= capacity


async def _update_shelter_isFull(shelter_oid):
    """Re-read counters and write isFull only when it flipped."""
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


async def _rollback_one(row, *, decrement_field: str) -> bool:
    """
    Atomically claim and decay a single expired row.

    Returns True if the row was actually decremented (incl. the shelter
    update), False if another sweeper got there first or the row was
    malformed.
    """
    # Atomic claim — the {rolledBack: false} filter ensures we don't
    # double-decrement if two sweepers raced.
    claim = await db["ShelterReservation"].update_one(
        {"_id": row["_id"], "rolledBack": False},
        {"$set": {"rolledBack": True}},
    )
    if claim.modified_count == 0:
        return False

    group_size = int(row.get("groupSize", 0) or 0)
    shelter_id = row.get("shelterId")
    if not shelter_id or group_size <= 0:
        return False
    try:
        shelter_oid = ObjectId(shelter_id)
    except Exception:
        return False

    await db["ShelterTest"].update_one(
        {"_id": shelter_oid},
        {"$inc": {decrement_field: -group_size}},
    )
    await _update_shelter_isFull(shelter_oid)
    return True


async def sweep_once() -> int:
    """
    Roll back every expired reservation in a single pass — both
    reserved-not-arrived rows (decrement reservedPlaces) and arrived rows
    (decrement actualOccupancy). Returns the total decremented rows.

    Errors on individual rows are swallowed so one bad row never starves
    the rest of the batch.
    """
    now = datetime.now(timezone.utc)
    # Both phases share the same `expiresAt < now AND rolledBack == false`
    # filter — the `arrived` flag tells us which counter to decrement.
    cursor = db["ShelterReservation"].find({
        "expiresAt":  {"$lt": now},
        "rolledBack": False,
    })

    rolled = 0
    async for row in cursor:
        try:
            field = "actualOccupancy" if row.get("arrived") else "reservedPlaces"
            if await _rollback_one(row, decrement_field=field):
                rolled += 1
        except Exception as e:
            log.warning("[sweeper] failed to roll back %s: %s", row.get("_id"), e)

    if rolled:
        log.info("[sweeper] rolled back %d expired reservation(s)", rolled)
    return rolled


async def sweeper_loop(interval_seconds: int = SWEEP_INTERVAL_SECONDS) -> None:
    """Long-running task — call from the FastAPI startup hook.

    Transient Mongo connection errors (DNS hiccups, brief Atlas downtime)
    are logged at INFO level with an exponential-ish backoff so they don't
    spam the console when the laptop loses internet. Unexpected exceptions
    keep their WARNING + interval — those are real bugs to look at.
    """
    log.info("[sweeper] starting (interval=%ss)", interval_seconds)
    backoff = 0
    while True:
        try:
            await sweep_once()
            backoff = 0     # success → reset
        except _NETWORK_ERRORS as e:
            backoff = min(backoff + 1, MAX_BACKOFF_TICKS)
            log.info(
                "[sweeper] mongo unreachable (tick %d/%d): %s",
                backoff, MAX_BACKOFF_TICKS, e,
            )
        except Exception as e:
            # Never let a sweep tick kill the loop. Real bugs go here.
            log.warning("[sweeper] tick failed: %s", e)
        await asyncio.sleep(interval_seconds * max(1, backoff))
