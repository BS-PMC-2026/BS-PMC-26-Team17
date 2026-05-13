"""
Shelter Sync Pipeline
---------------------
1. Fetches shelter records from data.gov.il CKAN API (Beer Sheva, 262 records)
2. Enriches each record with alertZone (point-in-polygon from oref-polygons)
3. Enriches each record with capacity (building area from Overpass API)
4. Upserts to ShelterTest collection in MongoDB Atlas

Safe: reads only from external APIs, writes ONLY to ShelterTest.
The existing Shelters collection is never touched.
"""

import os
import math
import time
import requests
import mongoengine
from dotenv import load_dotenv

load_dotenv()

# ─── Settings ────────────────────────────────────────────────────────────────

CKAN_RESOURCE_ID    = "e191d913-11e4-4d87-a4b2-91587aab6611"
CKAN_URL            = "https://data.gov.il/api/3/action/datastore_search"
OREF_POLYGONS_URL   = "https://oref-polygons.pages.dev/locations_polygons.json"
GOOGLE_GEOCODE_URL  = "https://maps.googleapis.com/maps/api/geocode/json"
GOOGLE_MAPS_API_KEY = os.getenv("GOOGLE_MAPS_API_KEY", "")
BATCH_SIZE          = 100

OVERPASS_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.openstreetmap.ru/api/interpreter",
]
RADIUS         = 30
SAFETY_FACTOR  = 0.5
SQM_PER_PERSON = 1.0

HEADERS = {"User-Agent": "ToSafePlace-SyncJob/1.0"}

# ─── MongoDB connection ───────────────────────────────────────────────────────

def connect_db():
    url  = os.getenv("MONGODB_URL", "mongodb://localhost:27017")
    name = os.getenv("DATABASE_NAME", "tosafe_place")
    mongoengine.connect(db=name, host=url, tlsAllowInvalidCertificates=True)


# ─── Step 1: Fetch from CKAN API ─────────────────────────────────────────────

def fetch_ckan_shelters():
    records = []
    offset  = 0
    while True:
        resp = requests.get(
            CKAN_URL,
            params={"resource_id": CKAN_RESOURCE_ID, "limit": BATCH_SIZE, "offset": offset},
            headers=HEADERS,
            timeout=30,
        )
        resp.raise_for_status()
        result  = resp.json().get("result", {})
        batch   = result.get("records", [])
        if not batch:
            break
        records.extend(batch)
        offset += BATCH_SIZE
        if offset >= result.get("total", 0):
            break
    return records


# ─── Step 2: Load oref polygons ──────────────────────────────────────────────

def load_oref_polygons():
    resp = requests.get(OREF_POLYGONS_URL, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    return resp.json()   # dict: zone_name → [[lng, lat], ...]


# ─── Step 3a: Point-in-polygon (ray casting) ─────────────────────────────────

def _normalize_coords(coords):
    """Convert to list of [lng, lat] pairs regardless of input format."""
    if not coords:
        return []
    # already nested: [[lng, lat], ...]
    if isinstance(coords[0], (list, tuple)):
        return coords
    # flat array: [lng, lat, lng, lat, ...]
    return [[coords[i], coords[i + 1]] for i in range(0, len(coords) - 1, 2)]


def point_in_polygon(lat, lng, coords):
    pairs = _normalize_coords(coords)
    if len(pairs) < 3:
        return False
    inside = False
    j = len(pairs) - 1
    for i in range(len(pairs)):
        xi, yi = pairs[i]   # lng, lat
        xj, yj = pairs[j]
        if ((yi > lat) != (yj > lat)) and \
           (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi):
            inside = not inside
        j = i
    return inside


def get_alert_zone(lat, lng, polygons):
    for zone_name, coords in polygons.items():
        if not isinstance(coords, list):
            continue
        if point_in_polygon(lat, lng, coords):
            return zone_name
    return "לא ידוע"


# ─── Step 3b: Nominatim reverse geocoding ────────────────────────────────────

def reverse_geocode(lat, lon):
    """Returns (city, address, neighborhood) from lat/lon via Google Maps Geocoding API."""
    try:
        resp = requests.get(
            GOOGLE_GEOCODE_URL,
            params={"latlng": f"{lat},{lon}", "key": GOOGLE_MAPS_API_KEY, "language": "he"},
            headers=HEADERS,
            timeout=10,
        )
        resp.raise_for_status()
        results = resp.json().get("results", [])
        if not results:
            return "", "", ""
        comps        = results[0].get("address_components", [])
        def get_comp(*types):
            for c in comps:
                if any(t in c["types"] for t in types):
                    return c["long_name"]
            return ""
        street_number = get_comp("street_number")
        route         = get_comp("route")
        city          = get_comp("locality")
        neighborhood  = get_comp("sublocality", "neighborhood", "sublocality_level_1")
        address       = " ".join(p for p in [route, street_number] if p)
        return city, address, neighborhood
    except Exception:
        return "", "", ""


# ─── Step 3c: Capacity from Overpass ─────────────────────────────────────────

def get_buildings_from_overpass(lat, lon):
    query = f"""
[out:json][timeout:10];
way(around:{RADIUS},{lat},{lon})["building"];
out geom tags;
"""
    last_error = None
    for url in OVERPASS_URLS:
        try:
            resp = requests.post(
                url, data={"data": query}, headers=HEADERS, timeout=30
            )
            if resp.status_code != 200:
                last_error = resp.text[:200]
                continue
            elements = resp.json().get("elements", [])
            if elements:
                return elements
        except Exception as e:
            last_error = str(e)
            time.sleep(1)
    raise RuntimeError(f"Overpass failed: {last_error}")


def _polygon_area_sqm(coords):
    """
    Shoelace formula for polygon area in square meters.
    coords = [(lon, lat), ...] in WGS84.
    Uses local metric approximation (accurate enough for building footprints).
    """
    if len(coords) < 3:
        return 0.0
    lat0 = sum(c[1] for c in coords) / len(coords)
    m_per_deg_lat = 111_320.0
    m_per_deg_lon = 111_320.0 * math.cos(math.radians(lat0))
    # convert to meters relative to first point
    pts = [(c[0] * m_per_deg_lon, c[1] * m_per_deg_lat) for c in coords]
    n = len(pts)
    area = 0.0
    for i in range(n):
        j = (i + 1) % n
        area += pts[i][0] * pts[j][1]
        area -= pts[j][0] * pts[i][1]
    return abs(area) / 2.0


def _point_in_polygon_xy(px, py, coords):
    """Ray casting for (px, py) inside polygon coords [(x,y),...]."""
    inside = False
    j = len(coords) - 1
    for i in range(len(coords)):
        xi, yi = coords[i]
        xj, yj = coords[j]
        if ((yi > py) != (yj > py)) and (px < (xj - xi) * (py - yi) / (yj - yi) + xi):
            inside = not inside
        j = i
    return inside


def _building_place_type(tags: dict) -> str:
    """Derive shelter place type from OSM building tags."""
    # Underground indicators
    min_level = tags.get("min_level") or tags.get("building:min_level") or ""
    underground_levels = tags.get("building:levels:underground") or ""
    try:
        if (min_level and int(min_level) < 0) or (underground_levels and int(underground_levels) > 0):
            return "תת קרקעי"
    except (ValueError, TypeError):
        pass
    # level tag (the element itself is on a negative floor)
    level = tags.get("level") or ""
    try:
        if level and int(str(level).split(";")[0]) < 0:
            return "תת קרקעי"
    except (ValueError, TypeError):
        pass
    return "עיל קרקעי"


def calculate_capacity(lat, lon, elements):
    best_coords   = None
    best_tags     = {}
    best_distance = float("inf")

    for element in elements:
        geometry = element.get("geometry", [])
        if len(geometry) < 3:
            continue
        coords = [(p["lon"], p["lat"]) for p in geometry]
        tags   = element.get("tags", {})

        # prefer the polygon that contains the target point
        if _point_in_polygon_xy(lon, lat, coords):
            best_coords = coords
            best_tags   = tags
            break

        # otherwise keep the closest one
        cx = sum(c[0] for c in coords) / len(coords)
        cy = sum(c[1] for c in coords) / len(coords)
        dist = math.hypot(cx - lon, cy - lat)
        if dist < best_distance:
            best_distance = dist
            best_coords   = coords
            best_tags     = tags

    if best_coords is None:
        return 0, None, None

    area_sqm      = _polygon_area_sqm(best_coords)
    capacity      = math.floor((area_sqm / SQM_PER_PERSON) * SAFETY_FACTOR)
    wheelchair    = best_tags.get("wheelchair")
    is_accessible = wheelchair in ("yes", "designated") if wheelchair else None
    place_type    = _building_place_type(best_tags)
    return capacity, is_accessible, place_type


# ─── Main sync function ───────────────────────────────────────────────────────

def _street_only(address):
    """Strip house number from address for fuzzy street matching."""
    import re
    return re.sub(r'\s*[\d,\-/]+.*$', '', address).strip()


def load_shelters_lookup():
    """Load Shelters collection into two lookup dicts: by name and by street."""
    from mongoengine.connection import get_db
    db = get_db()
    docs = list(db["Shelters"].find({}, {"_id": 0}))
    by_name   = {d["name"]: d for d in docs if d.get("name")}
    by_street = {}
    for d in docs:
        street = _street_only(d.get("address", ""))
        if street and street not in by_street:
            by_street[street] = d
    return by_name, by_street


def run_sync():
    from sync.models import ShelterTest

    connect_db()

    print("📡 Fetching shelters from CKAN API...")
    records = fetch_ckan_shelters()
    print(f"   → {len(records)} records fetched")

    print("🗺  Loading oref polygons...")
    polygons = load_oref_polygons()
    print(f"   → {len(polygons)} zones loaded")

    print("🏢 Loading Shelters lookup...")
    shelters_by_name, shelters_by_street = load_shelters_lookup()
    print(f"   → {len(shelters_by_name)} named shelters, {len(shelters_by_street)} streets indexed")

    new_count     = 0
    updated_count = 0
    error_count   = 0
    changes       = {}   # name → [list of "field: old → new"]

    for i, rec in enumerate(records, 1):
        name = rec.get("name", "")
        lat  = float(rec.get("lat", 0))
        lon  = float(rec.get("lon", 0))

        if not lat or not lon:
            error_count += 1
            continue

        try:
            existing = ShelterTest.objects(name=name).first()
            is_new   = existing is None
            shelter  = existing or ShelterTest(name=name)
            record_changes = []

            def track(field, old_val, new_val):
                if str(old_val) != str(new_val):
                    record_changes.append(f"{field}: {old_val!r} → {new_val!r}")

            # API fields — always update
            track("name", shelter.name, name)
            shelter.name = name
            track("lat", shelter.lat, lat)
            shelter.lat = lat
            track("lng", shelter.lng, lon)
            shelter.lng = lon

            # alertZone — only if missing
            if not shelter.alertZone or shelter.alertZone == "לא ידוע":
                new_zone = get_alert_zone(lat, lon, polygons)
                track("alertZone", shelter.alertZone, new_zone)
                shelter.alertZone = new_zone

            # address — always update from coordinates (road name from Nominatim)
            # city / neighborhood — only if missing
            city, address, neighborhood = reverse_geocode(lat, lon)
            if address:
                track("address", shelter.address, address)
                shelter.address = address
            if city and not shelter.city:
                track("city", shelter.city, city)
                shelter.city = city
            if neighborhood and not shelter.neighborhood:
                track("neighborhood", shelter.neighborhood, neighborhood)
                shelter.neighborhood = neighborhood
            time.sleep(1)   # Nominatim rate limit: 1 req/sec

            # capacity + isAccessible + placeType — only if missing
            if not shelter.capacity or shelter.capacity == 0:
                try:
                    elements = get_buildings_from_overpass(lat, lon)
                    new_cap, new_accessible, new_place_type = calculate_capacity(lat, lon, elements)
                    track("capacity", shelter.capacity, new_cap)
                    shelter.capacity = new_cap
                    if new_accessible is not None and not shelter.isAccessible:
                        track("isAccessible", shelter.isAccessible, new_accessible)
                        shelter.isAccessible = new_accessible
                    if new_place_type and not shelter.placeType:
                        track("placeType", shelter.placeType, new_place_type)
                        shelter.placeType = new_place_type
                    time.sleep(0.5)   # rate limit
                except Exception:
                    shelter.capacity = 0

            # ── Match with Shelters collection ────────────────────────────────
            # Priority: exact name match → street match
            matched = shelters_by_name.get(name)
            if not matched:
                street = _street_only(shelter.address)
                if street:
                    matched = shelters_by_street.get(street)

            if matched:
                # Fields where Shelters collection always wins (overrides Overpass/defaults)
                ALWAYS_OVERRIDE = ["placeType", "isAccessible"]
                SHELTER_FIELDS = [
                    ("placeType",         "placeType",         ""),
                    ("isAccessible",      "isAccessible",      False),
                    ("hasStairs",         "hasStairs",         False),
                    ("shouldBeOpen",      "shouldBeOpen",      True),
                    ("accessStatus",      "accessStatus",      "unknown"),
                    ("cleanlinessStatus", "cleanlinessStatus", "unknown"),
                    ("number",            "number",            ""),
                    ("area",              "area",              ""),
                    ("capacity",          "capacity",          0),
                ]
                for shelter_field, src_field, default in SHELTER_FIELDS:
                    src_val = matched.get(src_field, default)
                    cur_val = getattr(shelter, shelter_field, default)
                    # placeType + isAccessible: Shelters collection always wins
                    # other fields: only update if still at default value
                    should_update = (shelter_field in ALWAYS_OVERRIDE) or (cur_val == default)
                    if src_val != default and should_update:
                        track(shelter_field, cur_val, src_val)
                        setattr(shelter, shelter_field, src_val)

            shelter.save()

            if record_changes:
                changes[name] = record_changes

            if is_new:
                new_count += 1
            else:
                updated_count += 1

            if i % 10 == 0:
                print(f"   ✓ {i}/{len(records)} processed...")

        except Exception as e:
            print(f"   ✗ Error on record {name}: {e}")
            error_count += 1

    # ── Change report ─────────────────────────────────────────────────────────
    print(f"\n📋 Change Report ({len(changes)} records with field updates):")
    shown = 0
    for shelter_name, field_changes in changes.items():
        if shown >= 20:
            print(f"  ... and {len(changes) - shown} more")
            break
        print(f"  [{shelter_name}]")
        for c in field_changes:
            print(f"    {c}")
        shown += 1

    # ── Phase 2: Shelters → ShelterTest (read-only from Shelters) ────────────
    print("\n🔄 Phase 2: syncing Shelters collection → ShelterTest...")
    existing_names = set(s.name for s in ShelterTest.objects.only("name"))
    phase2_new = 0
    phase2_errors = 0

    from mongoengine.connection import get_db
    db = get_db()
    all_shelters = list(db["Shelters"].find({}, {"_id": 0}))

    for s in all_shelters:
        s_name = s.get("name", "")
        if not s_name or s_name in existing_names:
            continue  # already in ShelterTest — skip

        s_address = s.get("address", "").strip()
        s_city    = s.get("city", "").strip()
        query     = f"{s_address}, {s_city}, ישראל" if s_address else ""
        if not query:
            continue

        try:
            # Forward geocode address → lat/lng (Google Maps)
            resp = requests.get(
                GOOGLE_GEOCODE_URL,
                params={"address": query, "key": GOOGLE_MAPS_API_KEY, "language": "he"},
                headers=HEADERS,
                timeout=10,
            )
            resp.raise_for_status()
            geo_results = resp.json().get("results", [])
            if not geo_results:
                phase2_errors += 1
                continue

            loc = geo_results[0]["geometry"]["location"]
            lat, lng = loc["lat"], loc["lng"]

            shelter = ShelterTest(name=s_name)
            shelter.lat              = lat
            shelter.lng              = lng
            shelter.city             = s_city
            shelter.address          = s_address
            shelter.neighborhood     = s.get("neighborhood", "")
            shelter.area             = s.get("area", "")
            shelter.number           = s.get("number", "")
            shelter.placeType        = s.get("placeType", "")
            shelter.shouldBeOpen     = s.get("shouldBeOpen", True)
            shelter.isAccessible     = s.get("isAccessible", False)
            shelter.hasStairs        = s.get("hasStairs", False)
            shelter.capacity         = s.get("capacity", 0)
            shelter.accessStatus     = s.get("accessStatus", "unknown")
            shelter.cleanlinessStatus= s.get("cleanlinessStatus", "unknown")
            shelter.alertZone        = get_alert_zone(lat, lng, polygons)
            shelter.save()

            existing_names.add(s_name)
            phase2_new += 1
            print(f"   ➕ Added from Shelters: {s_name} ({s_address})")

        except Exception as e:
            print(f"   ✗ Phase2 error on {s_name}: {e}")
            phase2_errors += 1

    print(f"   → Phase 2 done: {phase2_new} added, {phase2_errors} errors")

    result = {
        "new": new_count, "updated": updated_count,
        "errors": error_count, "changed_fields": len(changes),
        "phase2_added": phase2_new, "phase2_errors": phase2_errors,
    }
    print(f"\n✅ Sync complete: {result}")
    return result


# ─── Run directly ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    run_sync()
