// ─── Types ────────────────────────────────────────────────────────────────────

export type Mode  = 'foot' | 'cycling' | 'driving';
export type Coord = { latitude: number; longitude: number };

export interface RouteResult {
  polyline:    Coord[];
  steps:       any[];
  distanceM:   number;
  durationSec: number;
  etaLabel:    string;
  distLabel:   string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

// Each mode has its own OSRM server — router.project-osrm.org only has driving data
const OSRM_BASE: Record<Mode, string> = {
  foot:    'https://routing.openstreetmap.de/routed-foot/route/v1/foot',
  cycling: 'https://routing.openstreetmap.de/routed-bike/route/v1/bike',
  driving: 'https://routing.openstreetmap.de/routed-car/route/v1/driving',
};

const SPEED_KMH: Record<Mode, number> = {
  foot:    5,
  cycling: 15,
  driving: -1, // -1 → use OSRM actual duration
};

// ─── NavigationService ────────────────────────────────────────────────────────

export class NavigationService {

  // ── Formatting ─────────────────────────────────────────────────────────────

  static formatDuration(seconds: number): string {
    const mins = Math.round(seconds / 60);
    if (mins < 60) return `${mins} min`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h}h ${m}m`;
  }

  static formatDistance(meters: number): string {
    return meters < 1000
      ? `${Math.round(meters)} m`
      : `${(meters / 1000).toFixed(1)} km`;
  }

  // ── Geometry ───────────────────────────────────────────────────────────────

  /** Haversine distance in meters between two coordinates */
  static haversineM(a: Coord, b: Coord): number {
    const R    = 6371000;
    const dLat = (b.latitude  - a.latitude)  * Math.PI / 180;
    const dLng = (b.longitude - a.longitude) * Math.PI / 180;
    const x =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(a.latitude * Math.PI / 180) *
      Math.cos(b.latitude * Math.PI / 180) *
      Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }

  /** Minimum distance (meters) from a point to any point on a polyline */
  static distToPolyline(point: Coord, polyline: Coord[]): number {
    if (!polyline.length) return Infinity;
    return polyline.reduce(
      (min, pt) => Math.min(min, NavigationService.haversineM(point, pt)),
      Infinity
    );
  }

  /** Index of the closest polyline point to the given position */
  static nearestPolylineIndex(polyline: Coord[], pos: Coord): number {
    let best = 0, bestDist = Infinity;
    polyline.forEach((pt, i) => {
      const d = NavigationService.haversineM(pt, pos);
      if (d < bestDist) { bestDist = d; best = i; }
    });
    return best;
  }

  /** Index of the closest OSRM step to the given position */
  static nearestStepIndex(steps: any[], pos: Coord): number {
    let best = 0, bestDist = Infinity;
    steps.forEach((step, i) => {
      const [lng, lat] = step.maneuver.location;
      const d = NavigationService.haversineM({ latitude: lat, longitude: lng }, pos);
      if (d < bestDist) { bestDist = d; best = i; }
    });
    return best;
  }

  /** True if the user is more than thresholdM meters away from the polyline */
  static isOffRoute(pos: Coord, polyline: Coord[], thresholdM = 50): boolean {
    return NavigationService.distToPolyline(pos, polyline) > thresholdM;
  }

  // ── ETA ────────────────────────────────────────────────────────────────────

  /**
   * Calculate ETA in seconds.
   * For driving, pass osrmSec (OSRM actual duration).
   * For foot/cycling, uses fixed average speed.
   */
  static calculateETA(distanceM: number, mode: Mode, osrmSec?: number): number {
    if (mode === 'driving' && osrmSec != null) return osrmSec;
    const speed = SPEED_KMH[mode] > 0 ? SPEED_KMH[mode] : 50; // driving fallback: 50 km/h
    return (distanceM / 1000 / speed) * 3600;
  }

  // ── Route slicing ──────────────────────────────────────────────────────────

  /**
   * Returns the remaining portion of the polyline from the user's position,
   * plus the remaining distance in meters.
   */
  static remainingRoute(
    polyline: Coord[],
    pos: Coord
  ): { polyline: Coord[]; distanceM: number } {
    const idx       = NavigationService.nearestPolylineIndex(polyline, pos);
    const remaining = polyline.slice(idx);
    let distanceM   = 0;
    for (let i = 0; i < remaining.length - 1; i++) {
      distanceM += NavigationService.haversineM(remaining[i], remaining[i + 1]);
    }
    return { polyline: remaining, distanceM };
  }

  // ── Step instructions ──────────────────────────────────────────────────────

  static stepInstruction(step: any): string {
    const type     = step?.maneuver?.type     || '';
    const modifier = step?.maneuver?.modifier || '';
    const name     = step?.name               || '';
    const on       = name ? ` on ${name}` : '';
    if (type === 'depart')           return `Head${on}`;
    if (type === 'arrive')           return '🏁 You have arrived';
    if (modifier === 'left')         return `Turn left${on}`;
    if (modifier === 'right')        return `Turn right${on}`;
    if (modifier === 'slight left')  return `Bear left${on}`;
    if (modifier === 'slight right') return `Bear right${on}`;
    if (modifier === 'sharp left')   return `Sharp left${on}`;
    if (modifier === 'sharp right')  return `Sharp right${on}`;
    if (modifier === 'straight')     return `Continue straight${on}`;
    if (modifier === 'uturn')        return 'Make a U-turn';
    return name ? `Continue on ${name}` : 'Continue straight';
  }

  // ── OSRM fetch ─────────────────────────────────────────────────────────────

  /** Fetch a route from OSRM and return a full RouteResult */
  static async fetchRoute(from: Coord, to: Coord, mode: Mode): Promise<RouteResult> {
    const url =
      `${OSRM_BASE[mode]}/` +
      `${from.longitude},${from.latitude};${to.longitude},${to.latitude}` +
      `?overview=full&geometries=geojson&steps=true`;

    const res  = await fetch(url);
    const data = await res.json();

    if (!data.routes?.length) throw new Error('No route found');

    const route = data.routes[0];
    const polyline: Coord[] = route.geometry.coordinates.map(
      ([lo, la]: number[]) => ({ latitude: la, longitude: lo })
    );
    const durationSec = NavigationService.calculateETA(
      route.distance, mode, route.duration
    );

    return {
      polyline,
      steps:       route.legs[0].steps,
      distanceM:   route.distance,
      durationSec,
      etaLabel:    NavigationService.formatDuration(durationSec),
      distLabel:   NavigationService.formatDistance(route.distance),
    };
  }

  /**
   * Emergency mode — auto-fetches a route without user mode selection.
   * Defaults to walking; callers (e.g., a siren auto-navigation) can pass
   * the user's saved transport mode instead.
   * Example: router.push('/navigate?lat=X&lng=Y&emergency=true&mode=driving')
   */
  static async emergencyRoute(from: Coord, to: Coord, mode: Mode = 'foot'): Promise<RouteResult> {
    return NavigationService.fetchRoute(from, to, mode);
  }
}
