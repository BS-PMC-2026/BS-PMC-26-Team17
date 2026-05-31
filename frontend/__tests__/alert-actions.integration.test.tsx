import React from 'react';
import { render, waitFor, act, fireEvent } from '@testing-library/react-native';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import type { Alert as PikudAlert } from '@/services/AlertsService';
import MapScreen from '../app/(tabs)/map';

/**
 * Integration test for the Task-1 alert flows on the map screen:
 *   - early-warning  → tapping the banner opens NearbyShelterSheet
 *   - siren          → auto-pushes /navigate with emergency=true&mode=<saved>
 *   - banner tap on siren → opens SirenModeSheet, picking re-pushes /navigate
 *
 * Strategy: capture the listener AlertsService.subscribe is handed, then fire
 * synthetic alerts to drive the flow without touching oref.org.il.
 */

// ── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  reverseGeocodeAsync: jest.fn(() => Promise.resolve([])),
  geocodeAsync: jest.fn(() => Promise.resolve([])),
}));

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() },
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
}));

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: jest.fn(),
}));

jest.mock('@/context/auth', () => ({
  useAuth: () => ({ user: null }),
}));

// Capture the listener AlertsService.subscribe is called with so tests can
// fire alerts on demand.
let alertListener: ((a: PikudAlert) => void) | null = null;
jest.mock('@/services/AlertsService', () => ({
  AlertsService: {
    subscribe: jest.fn((listener: any) => {
      alertListener = listener;
      return () => { alertListener = null; };
    }),
    injectFakeAlert: jest.fn(),
  },
}));

// OrefZonesService just needs to look loaded so the map renders.
jest.mock('@/services/OrefZonesService', () => ({
  OrefZonesService: {
    load: jest.fn(() => Promise.resolve()),
    getZone: jest.fn(() => null),
  },
}));

const mockPostMessage = jest.fn();
let webOnMessage: ((event: any) => void) | null = null;

jest.mock('react-native-webview', () => {
  const React = require('react');
  const { View } = require('react-native');
  const MockWebView = React.forwardRef((props: any, ref: any) => {
    React.useImperativeHandle(ref, () => ({
      postMessage: mockPostMessage,
      injectJavaScript: jest.fn(),
    }));
    webOnMessage = props.onMessage;
    return React.createElement(View, { testID: 'map-webview' });
  });
  return { WebView: MockWebView };
});

// ── Helpers ──────────────────────────────────────────────────────────────────

const mockLocation = Location as jest.Mocked<typeof Location>;
const mockRouter = router as jest.Mocked<typeof router>;
const mockAsyncStorage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;
const mockUseFocusEffect = useFocusEffect as jest.Mock;

// Three shelters: one very close, one further, one closed (must be excluded).
const SHELTERS = [
  {
    id: 'near-1', lat: 32.0801, lng: 34.7801,
    name: 'Near Shelter', address: 'a1', accessStatus: 'open',
  },
  {
    id: 'far-1',  lat: 32.090, lng: 34.781,
    name: 'Far Shelter',  address: 'a2', accessStatus: 'open',
  },
  {
    id: 'closed-1', lat: 32.0801, lng: 34.7802, // closer than near-1
    name: 'Closed Shelter', address: 'a3', accessStatus: 'closed',
  },
];

const setupStorage = (settings: Record<string, unknown> | null) => {
  mockAsyncStorage.getItem.mockImplementation((key: string) => {
    if (key === 'userSettings') {
      return Promise.resolve(settings ? JSON.stringify(settings) : null);
    }
    return Promise.resolve(null);
  });
};

const renderMap = async () => {
  global.fetch = jest.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ shelters: SHELTERS }),
    } as Response),
  ) as jest.Mock;

  const utils = render(<MapScreen />);
  // Wait until the AlertsService subscribe ran AND the WebView captured onMessage.
  await waitFor(() => {
    expect(alertListener).not.toBeNull();
    expect(webOnMessage).not.toBeNull();
  });
  // Fire WebView ready so any "wait for ready" effects can proceed.
  await act(async () => {
    webOnMessage?.({ nativeEvent: { data: JSON.stringify({ type: 'ready' }) } });
  });
  // Wait for shelters to land in state (setShelters posted to WebView).
  await waitFor(() => {
    const setSheltersCall = mockPostMessage.mock.calls.find(c => {
      try { return JSON.parse(c[0]).type === 'setShelters'; } catch { return false; }
    });
    expect(setSheltersCall).toBeDefined();
  });
  return utils;
};

const fireAlert = async (alert: PikudAlert) => {
  await act(async () => {
    alertListener?.(alert);
  });
};

const lastNavigatePush = (): string | null => {
  const calls = mockRouter.push.mock.calls.filter(([url]) =>
    typeof url === 'string' && (url as string).startsWith('/navigate'),
  );
  return calls.length > 0 ? (calls[calls.length - 1][0] as string) : null;
};

// ── Suite ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  alertListener = null;
  webOnMessage = null;
  // Run the focus effect inline — settings are loaded from AsyncStorage here.
  mockUseFocusEffect.mockImplementation((cb: any) => { cb(); });
  mockLocation.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' } as any);
  mockLocation.getCurrentPositionAsync.mockResolvedValue({
    coords: { latitude: 32.080, longitude: 34.780 },
  } as any);
});

describe('Alert actions on the map screen', () => {

  it('siren auto-pushes /navigate to the nearest open shelter with emergency=true&mode=<saved>', async () => {
    setupStorage({ transportMode: 'driving' });
    await renderMap();

    await fireAlert({ id: 's1', kind: 'siren', title: 'אזעקה', areas: ['באר שבע'] });

    await waitFor(() => {
      const url = lastNavigatePush();
      expect(url).not.toBeNull();
      expect(url!).toContain('emergency=true');
      expect(url!).toContain('mode=driving');
      // The "near" shelter should win over "closed-1" (filtered) and "far-1".
      expect(url!).toContain(`lat=${SHELTERS[0].lat}`);
      expect(url!).toContain(`lng=${SHELTERS[0].lng}`);
    });
  });

  it('siren defaults to walking when no transportMode is saved', async () => {
    setupStorage(null);
    await renderMap();

    await fireAlert({ id: 's2', kind: 'siren', title: 'אזעקה', areas: [] });

    await waitFor(() => {
      const url = lastNavigatePush();
      expect(url).not.toBeNull();
      expect(url!).toContain('mode=walking');
    });
  });

  it('siren is deduped per alert id — the same id never fires two navigations', async () => {
    setupStorage({ transportMode: 'walking' });
    await renderMap();

    const alert: PikudAlert = { id: 'dup', kind: 'siren', title: 'אזעקה', areas: [] };
    await fireAlert(alert);
    await fireAlert(alert);

    const navCalls = mockRouter.push.mock.calls.filter(([url]) =>
      typeof url === 'string' && (url as string).startsWith('/navigate'),
    );
    expect(navCalls).toHaveLength(1);
  });

  it('early-warning does NOT auto-navigate; tapping the banner opens the nearby-shelter sheet', async () => {
    setupStorage({ transportMode: 'walking' });
    const { getByTestId, queryByTestId } = await renderMap();

    await fireAlert({ id: 'e1', kind: 'early', title: 'התרעה מוקדמת', areas: ['באר שבע'] });

    // No /navigate push from a pre-alarm.
    expect(lastNavigatePush()).toBeNull();
    // Banner is shown; sheet is hidden until tap.
    expect(queryByTestId('nearby-sheet-list')).toBeNull();

    fireEvent.press(getByTestId('alert-banner-press'));
    await waitFor(() => {
      expect(getByTestId('nearby-sheet-list')).toBeTruthy();
      // Only open shelters appear (closed-1 is filtered).
      expect(getByTestId('nearby-sheet-row-near-1')).toBeTruthy();
      expect(getByTestId('nearby-sheet-row-far-1')).toBeTruthy();
      expect(queryByTestId('nearby-sheet-row-closed-1')).toBeNull();
    });
  });

  it('siren-banner tap opens the SirenModeSheet, and picking a new mode re-pushes /navigate', async () => {
    setupStorage({ transportMode: 'walking' });
    const { getByTestId } = await renderMap();

    await fireAlert({ id: 's3', kind: 'siren', title: 'אזעקה', areas: [] });
    // First push was the auto-navigate (mode=walking).
    await waitFor(() => {
      expect(lastNavigatePush()).toContain('mode=walking');
    });
    const initialNavCount = mockRouter.push.mock.calls.filter(([url]) =>
      typeof url === 'string' && (url as string).startsWith('/navigate'),
    ).length;

    fireEvent.press(getByTestId('alert-banner-press'));
    await waitFor(() => expect(getByTestId('siren-mode-driving')).toBeTruthy());

    fireEvent.press(getByTestId('siren-mode-driving'));
    await waitFor(() => {
      const navCalls = mockRouter.push.mock.calls.filter(([url]) =>
        typeof url === 'string' && (url as string).startsWith('/navigate'),
      );
      expect(navCalls.length).toBe(initialNavCount + 1);
      expect(navCalls[navCalls.length - 1][0]).toContain('mode=driving');
    });
  });
});
