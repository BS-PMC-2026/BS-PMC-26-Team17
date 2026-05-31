/**
 * Pikud HaOref alert zones.
 *
 * Loads the official polygon dictionary (the same one
 * `Backend/sync/sync_shelters.py` uses) and exposes a point-in-polygon
 * helper so any screen can ask "which Pikud HaOref zone is the user in?"
 *
 * Data source: { zoneName → [[lng, lat], ...] } — coordinates may also
 * arrive as a flat `[lng, lat, lng, lat, ...]` array; the helper normalizes
 * both forms before running ray-casting.
 */

const POLYGONS_URL = 'https://oref-polygons.pages.dev/locations_polygons.json';

type Polygons = Record<string, unknown>;

class OrefZonesServiceImpl {
  private polygons: Polygons | null = null;
  private loadingPromise: Promise<void> | null = null;

  /**
   * Fetch and cache the polygons. Safe to call repeatedly — subsequent
   * calls return immediately if already loaded, or join the in-flight
   * promise if a load is already happening.
   */
  async load(): Promise<void> {
    if (this.polygons) return;
    if (this.loadingPromise) return this.loadingPromise;
    this.loadingPromise = (async () => {
      try {
        const res = await fetch(POLYGONS_URL);
        if (!res.ok) return;
        this.polygons = await res.json();
      } catch {
        // Network failure → polygons stay null, callers fall back gracefully
      } finally {
        this.loadingPromise = null;
      }
    })();
    return this.loadingPromise;
  }

  /** Returns the zone name containing (lat, lng), or `null` if unknown. */
  getZone(lat: number, lng: number): string | null {
    if (!this.polygons) return null;
    for (const name of Object.keys(this.polygons)) {
      const pairs = this.normalize(this.polygons[name]);
      if (pairs.length >= 3 && this.pointInPolygon(lat, lng, pairs)) {
        return name;
      }
    }
    return null;
  }

  // ── private helpers ──────────────────────────────────────────────────────

  /** Ray-casting — direct TS port of the Python in `sync_shelters.py`. */
  private pointInPolygon(lat: number, lng: number, pairs: number[][]): boolean {
    let inside = false;
    let j = pairs.length - 1;
    for (let i = 0; i < pairs.length; i++) {
      const xi = pairs[i][0], yi = pairs[i][1]; // lng, lat
      const xj = pairs[j][0], yj = pairs[j][1];
      if (((yi > lat) !== (yj > lat)) &&
          (lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi)) {
        inside = !inside;
      }
      j = i;
    }
    return inside;
  }

  /** Accepts either [[lng,lat],...] or [lng,lat,lng,lat,...]. */
  private normalize(coords: unknown): number[][] {
    if (!Array.isArray(coords) || coords.length === 0) return [];
    // Already nested
    if (Array.isArray(coords[0])) {
      return coords as number[][];
    }
    // Flat — pair up consecutive numbers
    const out: number[][] = [];
    for (let i = 0; i < coords.length - 1; i += 2) {
      out.push([coords[i] as number, coords[i + 1] as number]);
    }
    return out;
  }
}

export const OrefZonesService = new OrefZonesServiceImpl();
