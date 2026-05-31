/**
 * ReservationService
 * -------------------
 * Thin wrapper around `POST /shelters/{id}/reserve`. Same payload shape
 * whether we're creating a new reservation or updating an existing one —
 * the backend upserts by (user_id, shelter_id, alert_id).
 *
 * Errors are surfaced via a rejected promise so callers can decide what
 * to do (toast vs silent). The map screen treats failures as silent —
 * the navigation still proceeds, the user just won't see their reservation
 * reflected on the map this cycle.
 */

export type AlertKind = 'early' | 'siren';

export interface ReserveParams {
  shelterId: string;
  userId:    string;
  alertId:   string;
  alertKind: AlertKind;
  groupSize: number;
}

export interface ReserveResult {
  reservation_id:   string;
  shelter_id:       string;
  reservedPlaces:   number;
  actualOccupancy:  number;
  capacity:         number;
  isFull:           boolean;
  expiresAt:        string;
}

export interface ReleaseParams {
  shelterId: string;
  userId:    string;
  alertId:   string;
}

export interface ReleaseResult {
  shelter_id:       string;
  released:         boolean;
  reservedPlaces:   number;
  actualOccupancy:  number;
  capacity:         number;
  isFull:           boolean;
}

export class ReservationService {
  /**
   * Create or update a reservation. Returns the shelter's post-update
   * counters so the caller can recolor map markers immediately.
   */
  static async reserve(p: ReserveParams): Promise<ReserveResult> {
    // Read at call time, not module load, so tests can override and so a
    // late .env load doesn't leave us stuck with `undefined`.
    const apiUrl = process.env.EXPO_PUBLIC_API_URL;
    if (!apiUrl) throw new Error('EXPO_PUBLIC_API_URL is not set');

    const res = await fetch(`${apiUrl}/shelters/${p.shelterId}/reserve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id:    p.userId,
        alert_id:   p.alertId,
        alert_kind: p.alertKind,
        group_size: p.groupSize,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`reserve failed: ${res.status} ${text}`);
    }

    return res.json();
  }

  /**
   * Cancel an active reservation early — used when the user backs out of
   * the navigate screen. Idempotent server-side: if there's no active row
   * (TTL already fired, or the user wasn't reserved here), returns 200
   * with `released: false` and no state change.
   */
  static async release(p: ReleaseParams): Promise<ReleaseResult> {
    const apiUrl = process.env.EXPO_PUBLIC_API_URL;
    if (!apiUrl) throw new Error('EXPO_PUBLIC_API_URL is not set');

    const res = await fetch(`${apiUrl}/shelters/${p.shelterId}/release`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id:  p.userId,
        alert_id: p.alertId,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`release failed: ${res.status} ${text}`);
    }

    return res.json();
  }
}
