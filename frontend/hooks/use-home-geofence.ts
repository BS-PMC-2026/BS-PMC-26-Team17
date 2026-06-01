/**
 * Watches the user's GPS position while the app is in the foreground and
 * notifies the backend when the user crosses in or out of their home
 * exclusion radius. The backend then pushes a notification back via Expo,
 * so the message arrives through the same channel as admin/report alerts.
 *
 * Only runs while the app is open (Expo Go doesn't support background
 * location). Re-entry/exit state is mirrored in AsyncStorage so a reload
 * doesn't trigger a duplicate notification, and the backend also dedupes
 * server-side.
 */
import { useEffect, useRef } from 'react';
import { DeviceEventEmitter } from 'react-native';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { API_URL } from '@/config';
import { useAuth } from '@/context/auth';

// Fired from the Settings screen after a successful save. The hook listens
// for it, re-fetches the home location, and re-evaluates the geofence — so
// changes register immediately even when the user is sitting still.
export const GEOFENCE_SETTINGS_CHANGED_EVENT = 'geofence:settings-changed';

// Fired from the map's SimJoystick (debug movement). Payload is the
// simulated lat/lng — or `null` when sim mode is turned off, signaling
// the hook to resume using the real GPS. While a non-null sim payload
// is active, the watchPositionAsync + periodic poll handlers ignore
// real GPS readings so the simulation owns the geofence check.
export const GEOFENCE_SIM_POSITION_EVENT = 'geofence:sim-position';
export type GeofenceSimPayload = { lat: number; lng: number } | null;

// Fired from the Settings screen when the user toggles the "accessible
// shelter only" preference. The map listens and updates its filter
// immediately so the change applies without remounting the screen.
export const ACCESSIBILITY_SETTINGS_CHANGED_EVENT = 'accessibility:settings-changed';

const DEFAULT_RADIUS_METERS = 500;
const MIN_DISTANCE_METERS = 25;
const MIN_INTERVAL_MS = 10_000;
// Belt-and-suspenders: even if the user is barely moving (so the
// distance-based watcher doesn't fire), re-check every this long so
// slow drift across the boundary still surfaces a notification.
const POLL_INTERVAL_MS = 15_000;

type GeofenceState = 'inside' | 'outside';

type Settings = {
  home_lat: number | null;
  home_lng: number | null;
  exclusion_radius: number;
};

function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

async function fetchSettings(userId: string): Promise<Settings | null> {
  try {
    const r = await fetch(`${API_URL}/api/settings/${userId}`);
    if (!r.ok) return null;
    return (await r.json()) as Settings;
  } catch {
    return null;
  }
}

type ResolvedSettings = { homeLat: number; homeLng: number; radius: number };

/**
 * Read the current home/radius live. AsyncStorage is the fast path — the
 * Settings screen writes there on every save, so this picks up changes
 * within one GPS tick. Falls back to the server for fresh installs that
 * haven't opened Settings yet.
 */
async function loadCurrentSettings(
  userId: string,
): Promise<ResolvedSettings | null> {
  try {
    const raw = await AsyncStorage.getItem('userSettings');
    if (raw) {
      const p = JSON.parse(raw);
      if (
        typeof p.homeLat === 'number' &&
        typeof p.homeLng === 'number' &&
        !(p.homeLat === 0 && p.homeLng === 0)
      ) {
        const r = parseFloat(p.radius);
        return {
          homeLat: p.homeLat,
          homeLng: p.homeLng,
          radius: r > 0 ? r : DEFAULT_RADIUS_METERS,
        };
      }
    }
  } catch {
    // ignore — fall through to server
  }

  const s = await fetchSettings(userId);
  if (!s || s.home_lat == null || s.home_lng == null) return null;
  if (s.home_lat === 0 && s.home_lng === 0) return null;
  return {
    homeLat: s.home_lat,
    homeLng: s.home_lng,
    radius: s.exclusion_radius > 0 ? s.exclusion_radius : DEFAULT_RADIUS_METERS,
  };
}

const LOCAL_COPY = {
  outside: {
    title: 'You left your safe zone',
    body: "You're outside your home radius — stay alert and know where the nearest shelter is.",
  },
  inside: {
    title: "You're back in your safe zone",
    body: "You've returned to within your home radius.",
  },
} as const;

async function showLocalNotification(event: GeofenceState): Promise<void> {
  // Local notifications work in Expo Go on both iOS and Android, so the
  // banner appears even when Expo's remote-push pipeline is blocked.
  const copy = LOCAL_COPY[event];
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: copy.title,
        body: copy.body,
        sound: 'default',
        data: { type: 'geofence', event },
      },
      trigger: null,
    });
  } catch (e) {
    console.log('[geofence] local notification failed:', e);
  }
}

async function reportEvent(userId: string, event: GeofenceState): Promise<void> {
  const wire = event === 'outside' ? 'exit' : 'enter';
  try {
    await fetch(`${API_URL}/api/geofence/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, event: wire }),
    });
  } catch (e) {
    console.log('[geofence] failed to report event:', e);
  }
}

/**
 * Compare a single GPS reading against the user's current home/radius
 * and fire notifications on transition. Shared by the movement-based
 * watcher and the settings-changed event handler.
 */
async function evaluateAndMaybeNotify(
  userId: string,
  coords: { latitude: number; longitude: number },
  stateKey: string,
  firstReadingFiredRef: { current: boolean },
): Promise<void> {
  const settings = await loadCurrentSettings(userId);
  if (!settings) return;

  const distance = haversineMeters(
    settings.homeLat,
    settings.homeLng,
    coords.latitude,
    coords.longitude,
  );
  const next: GeofenceState =
    distance > settings.radius ? 'outside' : 'inside';
  const prev = (await AsyncStorage.getItem(stateKey)) as
    | GeofenceState
    | null;

  // First reading per session always fires so the user gets a status
  // banner on app launch. After that, only real transitions trigger.
  const isFirstReading = !firstReadingFiredRef.current;
  if (!isFirstReading && prev === next) return;
  firstReadingFiredRef.current = true;

  await AsyncStorage.setItem(stateKey, next);
  await Promise.all([
    showLocalNotification(next),
    reportEvent(userId, next),
  ]);
}

export function useHomeGeofence() {
  const { user } = useAuth();
  const userId = user?.id;
  const subscriptionRef = useRef<Location.LocationSubscription | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Reset on every fresh hook arm so the user gets a status banner the
  // first time location resolves in a session, regardless of stored state.
  const firstReadingFiredRef = useRef(false);
  // While the SimJoystick is active, this holds the simulated coords and
  // the GPS-based handlers skip their readings so the simulation owns
  // the geofence check.
  const simCoordsRef = useRef<{ latitude: number; longitude: number } | null>(null);

  useEffect(() => {
    if (!userId) return;

    let cancelled = false;
    const stateKey = `geofence:lastState:${userId}`;

    const checkOnce = async () => {
      // If sim mode is active, use the simulated coords directly and
      // don't poll real GPS — that would override the simulation.
      if (simCoordsRef.current) {
        await evaluateAndMaybeNotify(
          userId,
          simCoordsRef.current,
          stateKey,
          firstReadingFiredRef,
        );
        return;
      }
      try {
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        await evaluateAndMaybeNotify(
          userId,
          loc.coords,
          stateKey,
          firstReadingFiredRef,
        );
      } catch (e) {
        console.log('[geofence] one-shot check failed:', e);
      }
    };

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted' || cancelled) return;

      // 1) Movement-based watcher — fires the moment the user moves
      //    more than MIN_DISTANCE_METERS. Skipped while sim mode is on.
      subscriptionRef.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          distanceInterval: MIN_DISTANCE_METERS,
          timeInterval: MIN_INTERVAL_MS,
        },
        async (loc) => {
          if (simCoordsRef.current) return;
          await evaluateAndMaybeNotify(
            userId,
            loc.coords,
            stateKey,
            firstReadingFiredRef,
          );
        },
      );

      // 2) Periodic re-check — catches slow drift, GPS jitter near
      //    the boundary, or stationary edge cases where the watcher
      //    never fires. Runs alongside the movement watcher.
      pollTimerRef.current = setInterval(() => {
        if (!cancelled) checkOnce();
      }, POLL_INTERVAL_MS);
    })();

    // 3) Settings save → re-evaluate without waiting for movement.
    const settingsSub = DeviceEventEmitter.addListener(
      GEOFENCE_SETTINGS_CHANGED_EVENT,
      checkOnce,
    );

    // 4) SimJoystick movement → use the simulated coords for the check
    //    and arrest the GPS-based handlers until sim mode is released.
    const simSub = DeviceEventEmitter.addListener(
      GEOFENCE_SIM_POSITION_EVENT,
      async (payload: GeofenceSimPayload) => {
        if (payload === null) {
          // Sim mode turned off → resume real GPS on the next tick.
          simCoordsRef.current = null;
          checkOnce();
          return;
        }
        simCoordsRef.current = {
          latitude: payload.lat,
          longitude: payload.lng,
        };
        await evaluateAndMaybeNotify(
          userId,
          simCoordsRef.current,
          stateKey,
          firstReadingFiredRef,
        );
      },
    );

    return () => {
      cancelled = true;
      subscriptionRef.current?.remove();
      subscriptionRef.current = null;
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      settingsSub.remove();
      simSub.remove();
    };
  }, [userId]);
}
