"""
Oref zone resolution + matching utilities.
==========================================

For Phase 2a's server-side targeting we need to answer two questions:

  1. Given a user's home coordinates, which Pikud HaOref zone are they in?
  2. Given a user's zone and the `areas[]` of an alert, does the alert
     apply to them?

(1) uses the official polygon dictionary from oref-polygons.pages.dev — the
same source `Backend/sync/sync_shelters.py` consumes to enrich shelters.
We load it lazily on first call and cache it for the lifetime of the
process (the dictionary is essentially static).

(2) uses a "parent city" match: zone strings come in the form
    "באר שבע - מערב" — the part before " - " is the city. A user in
"באר שבע - מערב" matches any alert whose `areas[]` contains some other
"באר שבע - …" zone (same rocket attack, same city — they're affected).

Exact-match still wins; the parent-city rule only kicks in as a fallback.
"""

import asyncio
import logging
from typing import Optional

import httpx

log = logging.getLogger(__name__)

OREF_POLYGONS_URL = "https://oref-polygons.pages.dev/locations_polygons.json"

# In-memory cache. Either None (not loaded yet) or a dict.
_polygons: Optional[dict] = None
_load_lock = asyncio.Lock()


async def load_polygons() -> Optional[dict]:
    """Fetch + cache the polygon dictionary. Safe to await concurrently."""
    global _polygons
    if _polygons is not None:
        return _polygons
    async with _load_lock:
        # Double-check after acquiring the lock — another coroutine may
        # have loaded while we were waiting.
        if _polygons is not None:
            return _polygons
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                res = await client.get(OREF_POLYGONS_URL)
                if res.status_code != 200:
                    log.warning("[oref-zones] polygons load failed: %s", res.status_code)
                    return None
                data = res.json()
        except Exception as e:
            log.warning("[oref-zones] polygons load error: %s", e)
            return None
        if not isinstance(data, dict):
            log.warning("[oref-zones] polygons payload was not a dict")
            return None
        _polygons = data
        log.info("[oref-zones] loaded %d polygons", len(_polygons))
        return _polygons


def reset_for_tests(polygons: Optional[dict] = None) -> None:
    """Test helper: replace (or clear) the cached polygons."""
    global _polygons
    _polygons = polygons


# ── Point-in-polygon (ray casting) ──────────────────────────────────────────
# Lifted from sync_shelters.py — kept here so app/core doesn't import the
# sync module's heavy mongoengine deps.

def _normalize_coords(coords) -> list[list[float]]:
    if not coords:
        return []
    if isinstance(coords[0], (list, tuple)):
        return coords
    # Flat [lng, lat, lng, lat, ...] → pair up
    return [[coords[i], coords[i + 1]] for i in range(0, len(coords) - 1, 2)]


def _point_in_polygon(lat: float, lng: float, coords) -> bool:
    pairs = _normalize_coords(coords)
    if len(pairs) < 3:
        return False
    inside = False
    j = len(pairs) - 1
    for i in range(len(pairs)):
        xi, yi = pairs[i]
        xj, yj = pairs[j]
        if ((yi > lat) != (yj > lat)) and (
            lng < (xj - xi) * (lat - yi) / (yj - yi) + xi
        ):
            inside = not inside
        j = i
    return inside


def resolve_zone(lat: float, lng: float) -> Optional[str]:
    """Find the zone name containing (lat, lng), or None if unknown.
    Assumes polygons are already cached — call `await load_polygons()` first."""
    if _polygons is None:
        return None
    for name, coords in _polygons.items():
        if not isinstance(coords, list):
            continue
        if _point_in_polygon(lat, lng, coords):
            return name
    return None


# ── Zone matching ────────────────────────────────────────────────────────────

def parent_city(zone: str) -> str:
    """Strip the sub-zone qualifier ('באר שבע - מערב' → 'באר שבע')."""
    if not zone:
        return ""
    return zone.split(" - ", 1)[0].strip()


def alert_matches_zone(user_zone: str, alert_areas: list[str]) -> bool:
    """Phase 2a matching rule: exact match OR same parent city."""
    if not user_zone or not alert_areas:
        return False
    if user_zone in alert_areas:
        return True
    user_city = parent_city(user_zone)
    if not user_city:
        return False
    for area in alert_areas:
        if parent_city(area) == user_city:
            return True
    return False


def parent_cities(areas: list[str]) -> list[str]:
    """Dedupe'd list of parent cities present in an alert's areas[]."""
    seen: list[str] = []
    for a in areas or []:
        c = parent_city(a)
        if c and c not in seen:
            seen.append(c)
    return seen
