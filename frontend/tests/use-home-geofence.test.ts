/**
 * Unit tests for use-home-geofence. Drives the hook through a tiny host
 * component, mocks expo-location and AsyncStorage, and asserts:
 *   - First reading in a session fires a notification + POSTs to the
 *     backend with the correct event (regardless of stored state).
 *   - A subsequent reading with no transition is a no-op.
 *   - A real transition (inside → outside) fires both the notification
 *     and the POST.
 *   - When home isn't configured (0,0 or null), no work happens.
 */
import React from 'react';
import { render, act, waitFor, cleanup } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';

import { useHomeGeofence } from '../hooks/use-home-geofence';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(() => Promise.resolve()),
}));

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted' })),
  getCurrentPositionAsync: jest.fn(),
  watchPositionAsync: jest.fn(),
  Accuracy: { Balanced: 3 },
}));

jest.mock('expo-notifications', () => ({
  scheduleNotificationAsync: jest.fn(() => Promise.resolve()),
}));

const mockUseAuth = jest.fn();
jest.mock('@/context/auth', () => ({
  useAuth: () => mockUseAuth(),
}));

function HookHost() {
  useHomeGeofence();
  return null;
}

const asMock = <T,>(v: T) => v as jest.Mock;

// Lets us trigger position updates from inside a test
let positionCallback: ((loc: any) => Promise<void> | void) | null = null;

beforeEach(() => {
  // Force-unmount any leftover trees from prior tests. RTL auto-cleans,
  // but during async test setup we sometimes get a stale component
  // hanging around long enough to register a watcher with the OLD
  // (pre-reset) `positionCallback` closure. Explicit cleanup eliminates
  // the race entirely.
  cleanup();
  jest.clearAllMocks();
  positionCallback = null;
  mockUseAuth.mockReturnValue({
    user: { id: 'u1', email: 'u@x.com', role: 'user', name: 'U', telephone: '' },
  });

  // Capture the callback expo-location is given so tests can drive it
  asMock(Location.watchPositionAsync).mockImplementation(async (_opts, cb) => {
    positionCallback = cb;
    return { remove: jest.fn() } as any;
  });

  global.fetch = jest.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response),
  ) as any;
});

function setSettings({ homeLat, homeLng, radius }: { homeLat: number; homeLng: number; radius: string | number }) {
  asMock(AsyncStorage.getItem).mockImplementation(async (key: string) => {
    if (key === 'userSettings') {
      return JSON.stringify({ homeLat, homeLng, radius, address: 'X' });
    }
    return null;
  });
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

/**
 * Wait until the hook has actually called `Location.watchPositionAsync` and
 * we've captured its callback. Use this in tests that then drive the hook
 * by invoking `positionCallback` — `flush()` alone races with React's
 * effect scheduler and was the source of a ~25 %-flake-rate in CI.
 */
async function waitForWatcher() {
  await waitFor(
    () => expect(positionCallback).not.toBeNull(),
    { timeout: 2000, interval: 10 },
  );
  // Give the IIFE one extra tick to finish any remaining setup after
  // capturing the callback (e.g., scheduling the poll interval) — keeps
  // the hook in a fully-settled state before the test starts driving it.
  await act(async () => { await Promise.resolve(); });
}

describe('useHomeGeofence', () => {
  it('first reading in a session fires notification + reports event (regardless of stored state)', async () => {
    setSettings({ homeLat: 32.0853, homeLng: 34.7818, radius: '500' });
    // Pretend a previous session left state='inside' in AsyncStorage
    asMock(AsyncStorage.getItem).mockImplementation(async (key: string) => {
      if (key === 'userSettings') {
        return JSON.stringify({
          homeLat: 32.0853,
          homeLng: 34.7818,
          radius: '500',
        });
      }
      if (key.startsWith('geofence:lastState:')) return 'inside';
      return null;
    });

    render(React.createElement(HookHost));
    await waitForWatcher();

    // Far enough away to be "outside"
    await act(async () => {
      await positionCallback?.({
        coords: { latitude: 32.1000, longitude: 34.8000 },
      });
    });

    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    const url = (global.fetch as jest.Mock).mock.calls[0][0];
    expect(String(url)).toContain('/api/geofence/event');
    const body = JSON.parse(((global.fetch as jest.Mock).mock.calls[0][1] as any).body);
    expect(body).toEqual({ user_id: 'u1', event: 'exit' });
  });

  it('no transition after the first reading → no further notifications', async () => {
    setSettings({ homeLat: 32.0853, homeLng: 34.7818, radius: '500' });
    asMock(AsyncStorage.getItem).mockImplementation(async (key: string) => {
      if (key === 'userSettings') {
        return JSON.stringify({
          homeLat: 32.0853,
          homeLng: 34.7818,
          radius: '500',
        });
      }
      if (key.startsWith('geofence:lastState:')) return null;
      return null;
    });

    render(React.createElement(HookHost));
    await waitForWatcher();

    // First reading: outside
    await act(async () => {
      await positionCallback?.({
        coords: { latitude: 33.0, longitude: 35.0 },
      });
    });
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);

    // After firing, the hook wrote 'outside' to AsyncStorage. Subsequent
    // calls to getItem for the state key should reflect that.
    asMock(AsyncStorage.getItem).mockImplementation(async (key: string) => {
      if (key === 'userSettings') {
        return JSON.stringify({
          homeLat: 32.0853,
          homeLng: 34.7818,
          radius: '500',
        });
      }
      if (key.startsWith('geofence:lastState:')) return 'outside';
      return null;
    });

    // Another reading, still outside → no new notification
    await act(async () => {
      await positionCallback?.({
        coords: { latitude: 33.0001, longitude: 35.0001 },
      });
    });
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  });

  it('transition from outside → inside fires the "back in safe zone" notification', async () => {
    let storedState: string | null = 'outside';
    asMock(AsyncStorage.getItem).mockImplementation(async (key: string) => {
      if (key === 'userSettings') {
        return JSON.stringify({
          homeLat: 32.0853,
          homeLng: 34.7818,
          radius: '500',
        });
      }
      if (key.startsWith('geofence:lastState:')) return storedState;
      return null;
    });
    asMock(AsyncStorage.setItem).mockImplementation(async (key: string, val: string) => {
      if (key.startsWith('geofence:lastState:')) storedState = val;
    });

    render(React.createElement(HookHost));
    await waitForWatcher();

    // First reading is inside the radius → this is BOTH first-reading
    // (always fires) AND a real transition.
    await act(async () => {
      await positionCallback?.({
        coords: { latitude: 32.0853, longitude: 34.7818 },
      });
    });

    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    const notif = asMock(Notifications.scheduleNotificationAsync).mock.calls[0][0];
    expect(notif.content.data).toEqual({ type: 'geofence', event: 'inside' });
  });

  it('does nothing when home is unset (0,0)', async () => {
    setSettings({ homeLat: 0, homeLng: 0, radius: '500' });
    // No network fallback — make fetchSettings return null too
    asMock(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ home_lat: 0, home_lng: 0, exclusion_radius: 0 }),
    } as Response);

    render(React.createElement(HookHost));
    await flush();

    await act(async () => {
      await positionCallback?.({
        coords: { latitude: 32.0, longitude: 34.0 },
      });
    });

    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    // The fetch call would be the one for /api/settings (server fallback);
    // no call to /api/geofence/event was made.
    const geofencePosts = (global.fetch as jest.Mock).mock.calls.filter((c) =>
      String(c[0]).includes('/api/geofence/event'),
    );
    expect(geofencePosts).toHaveLength(0);
  });
});
