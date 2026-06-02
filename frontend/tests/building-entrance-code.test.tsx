import React from 'react';
import { render, waitFor, act } from '@testing-library/react-native';

/**
 * Tests for the building entrance-code card inside navigate.tsx's alternative
 * shelter overlay.
 *
 * checkAlternativeNeeded is triggered from applyRoute when alertKind === 'siren'.
 * When an approved building exists in the user's building list it shows:
 *   - title 'אין מקלט בטווח'
 *   - the building address
 *   - 'קוד כניסה: X' (hidden after 5 minutes via setTimeout)
 */

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(() =>
    Promise.resolve({ status: 'granted' }),
  ),
  getCurrentPositionAsync: jest.fn(() =>
    Promise.resolve({ coords: { latitude: 32, longitude: 34 } }),
  ),
  getLastKnownPositionAsync: jest.fn(() => Promise.resolve(null)),
  watchPositionAsync: jest.fn(() =>
    Promise.resolve({ remove: jest.fn() }),
  ),
  Accuracy: { High: 4, Balanced: 3 },
}));

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: jest.fn(),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
  SafeAreaView: ({ children }: any) => children,
}));

jest.mock('react-native-webview', () => {
  const React = require('react');
  const { View } = require('react-native');
  const MockWebView = React.forwardRef((_props: any, ref: any) => {
    React.useImperativeHandle(ref, () => ({ postMessage: jest.fn() }));
    return React.createElement(View, { testID: 'navigate-webview' });
  });
  return { WebView: MockWebView };
});

jest.mock('@/services/NavigationService', () => ({
  NavigationService: {
    fetchRoute: jest.fn(() =>
      Promise.resolve({
        polyline: [], steps: [], distanceM: 0, durationSec: 0,
        etaLabel: '0 min', distLabel: '0 m',
      }),
    ),
    emergencyRoute: jest.fn(() =>
      Promise.resolve({
        polyline: [], steps: [], distanceM: 500, durationSec: 120,
        etaLabel: '2 min', distLabel: '500 m',
      }),
    ),
    haversineM:           jest.fn(() => 9999),
    formatDistance:       (m: number) => `${m} m`,
    formatDuration:       (s: number) => `${s} s`,
    calculateETA:         jest.fn(() => 0),
    distToPolyline:       () => Infinity,
    nearestPolylineIndex: () => 0,
    nearestStepIndex:     () => 0,
    isOffRoute:           () => false,
    stepInstruction:      () => '',
    remainingRoute:       (poly: any[]) => ({ polyline: poly, distanceM: 0 }),
  },
}));

jest.mock('@/services/ReservationService', () => ({
  ReservationService: {
    reserve: jest.fn(() => Promise.resolve({})),
    release: jest.fn(() => Promise.resolve({})),
    arrive:  jest.fn(() => Promise.resolve({})),
  },
}));

jest.mock('@/context/auth', () => ({
  useAuth: () => ({
    user: { id: 'user-1', email: 'u@x.com', name: 'U', role: 'user' },
  }),
}));

jest.mock('@/config', () => ({ API_URL: 'http://localhost:8000' }));

jest.mock('@/services/alertTimes', () => ({
  getAlertTime: jest.fn(() => 30),
  ALERT_TIMES: {},
}));

jest.mock('@/services/OrefZonesService', () => ({
  OrefZonesService: {
    load:    jest.fn(() => Promise.resolve()),
    getZone: jest.fn(() => 'תל אביב - מרכז העיר'),
  },
}));

// ── Shared references ─────────────────────────────────────────────────────────

const mockUseLocalSearchParams =
  require('expo-router').useLocalSearchParams as jest.Mock;

const mockEmergencyRoute =
  require('@/services/NavigationService').NavigationService
    .emergencyRoute as jest.Mock;

// An approved building returned by the buildings API.
const APPROVED_BUILDING = {
  registrationStatus: 'approved',
  address:            'רחוב הרצל 1, תל אביב',
  entranceCode:       '4321',
};

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeAll(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

beforeEach(() => {
  jest.clearAllMocks();

  // ETA (120 s) > alertTime (30 s) → overlay should appear.
  mockEmergencyRoute.mockResolvedValue({
    polyline: [], steps: [], distanceM: 500, durationSec: 120,
    etaLabel: '2 min', distLabel: '500 m',
  });

  // Default: no buildings — individual tests override when needed.
  (global.fetch as jest.Mock) = jest.fn(() =>
    Promise.resolve({
      json: () => Promise.resolve({ buildings: [] }),
    }),
  );
});

// ── Helper ────────────────────────────────────────────────────────────────────

/**
 * fromLat / fromLng seed userLocation immediately, so the emergency
 * useEffect fires on mount and applyRoute → checkAlternativeNeeded runs
 * without waiting for real GPS resolution.
 */
const renderNavigate = (params: Record<string, string | undefined>) => {
  mockUseLocalSearchParams.mockReturnValue(params);
  const NavigateScreen = require('../app/navigate').default;
  return render(<NavigateScreen />);
};

const BASE_PARAMS = {
  lat: '32.1', lng: '34.8', name: 'Shelter',
  emergency: 'true', mode: 'walking',
  alertKind: 'siren',
  fromLat: '32.0', fromLng: '34.7',
} as const;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('navigate.tsx — building entrance code display', () => {
  it('shows building address and entrance code when eta > alertTime and there is an approved building', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      json: () => Promise.resolve({ buildings: [APPROVED_BUILDING] }),
    });

    const { getByText } = renderNavigate({ ...BASE_PARAMS });

    await waitFor(() => getByText('אין מקלט בטווח'));
    expect(getByText(APPROVED_BUILDING.address)).toBeTruthy();
    expect(getByText(`קוד כניסה: ${APPROVED_BUILDING.entranceCode}`)).toBeTruthy();
  });

  it('hides entrance code after 5 minutes', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      json: () => Promise.resolve({ buildings: [APPROVED_BUILDING] }),
    });

    // Intercept only the 5-minute code-expiry timeout, letting all other
    // timers (React scheduler, waitFor polling) run normally.
    let codeExpireCallback: (() => void) | undefined;
    const realSetTimeout = global.setTimeout;
    jest.spyOn(global, 'setTimeout').mockImplementation(
      (fn: any, delay?: number, ...args: any[]) => {
        if (delay === 5 * 60 * 1000) {
          codeExpireCallback = fn;
          return 0 as any;
        }
        return realSetTimeout(fn, delay, ...args) as any;
      },
    );

    const { getByText, queryByText } = renderNavigate({ ...BASE_PARAMS });

    // Wait for the card with the code to appear.
    await waitFor(() =>
      getByText(`קוד כניסה: ${APPROVED_BUILDING.entranceCode}`),
    );

    // Fire the captured expiry callback (simulates 5 minutes passing).
    act(() => codeExpireCallback?.());

    expect(queryByText(/קוד כניסה/)).toBeNull();
    expect(getByText('פג תוקף הקוד')).toBeTruthy();

    jest.restoreAllMocks();
  });

  it('does not show entrance code when there is no approved building', async () => {
    // global.fetch already returns { buildings: [] } from beforeEach.

    const { queryByText, getByText } = renderNavigate({ ...BASE_PARAMS });

    // The overlay still appears (eta > alertTime) but shows safety
    // instructions instead of a building card.
    await waitFor(() =>
      getByText(/שכבו על הקרקע והגנו על הראש עם הידיים/),
    );

    expect(queryByText(/קוד כניסה/)).toBeNull();
    expect(queryByText('אין מקלט בטווח')).toBeNull();
  });
});
