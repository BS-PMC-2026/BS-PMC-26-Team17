import React from 'react';
import { render, waitFor, act } from '@testing-library/react-native';

/**
 * Tests for the alternative building navigation overlay in navigate.tsx.
 *
 * checkAlternativeNeeded is triggered from applyRoute when alertKind === 'siren'.
 * It fetches approved buildings, checks reachability against half the alert time,
 * and either reroutes to the closest reachable building or falls back to
 * safety instructions.
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

// mockHaversineM is defined before jest.mock so the factory closure captures it.
// The factory is evaluated lazily (first require), by which time this is set.
const mockHaversineM = jest.fn(() => 100);

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
    haversineM:           (...args: any[]) => mockHaversineM(...args),
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
  ALERT_TIMES:  {},
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

const mockGetAlertTime =
  require('@/services/alertTimes').getAlertTime as jest.Mock;

// Building used in "reachable" tests.
// Reachability condition: haversineM(user, building) / 83 <= alertTime / 2
// With alertTime=30 and haversineM=100: 100/83 ≈ 1.2 <= 15 ✓
const APPROVED_BUILDING = {
  registrationStatus: 'approved',
  address:            'רחוב הרצל 1, תל אביב',
  entranceCode:       '4321',
  lat:                32.05,
  lng:                34.75,
};

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeAll(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

beforeEach(() => {
  jest.clearAllMocks();
  // Reset haversineM to "reachable" default (100m < 1245m threshold).
  mockHaversineM.mockReturnValue(100);

  mockEmergencyRoute.mockResolvedValue({
    polyline: [], steps: [], distanceM: 500, durationSec: 120,
    etaLabel: '2 min', distLabel: '500 m',
  });
  mockGetAlertTime.mockReturnValue(30);

  (global.fetch as jest.Mock) = jest.fn(() =>
    Promise.resolve({
      json: () => Promise.resolve({ buildings: [] }),
    }),
  );
});

// ── Helper ────────────────────────────────────────────────────────────────────

/**
 * fromLat / fromLng seed userLocation immediately so the emergency useEffect
 * fires on mount without waiting for real GPS resolution.
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

describe('navigate.tsx — alternative building navigation', () => {
  it('shows building address and entrance code and reroutes when eta > alertTime and building is reachable', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      json: () => Promise.resolve({ buildings: [APPROVED_BUILDING] }),
    });

    const { getByText, getAllByText } = renderNavigate({ ...BASE_PARAMS });

    await waitFor(() => getByText(/אין מקלט בטווח/));
    expect(getAllByText(APPROVED_BUILDING.address).length).toBeGreaterThanOrEqual(1);
    expect(getByText(`קוד כניסה: ${APPROVED_BUILDING.entranceCode}`)).toBeTruthy();

    // First emergencyRoute: original shelter. Second: reroute to building.
    await waitFor(() => expect(mockEmergencyRoute).toHaveBeenCalledTimes(2));
    expect(mockEmergencyRoute).toHaveBeenNthCalledWith(
      2,
      { latitude: 32.0, longitude: 34.7 },
      { latitude: APPROVED_BUILDING.lat, longitude: APPROVED_BUILDING.lng },
      'foot',
    );
  });

  it('shows safety instructions when eta > alertTime and the building is too far (beyond half alertTime)', async () => {
    // distance / 83 > alertTime / 2 → not reachable (2000 / 83 ≈ 24 > 15)
    mockHaversineM.mockReturnValue(2000);

    (global.fetch as jest.Mock).mockResolvedValue({
      json: () => Promise.resolve({ buildings: [APPROVED_BUILDING] }),
    });

    const { getByText, queryByText } = renderNavigate({ ...BASE_PARAMS });

    await waitFor(() =>
      getByText(/שכבו על הקרקע והגנו על הראש עם הידיים/),
    );
    expect(queryByText(/קוד כניסה/)).toBeNull();
    expect(queryByText(/אין מקלט בטווח/)).toBeNull();
  });

  it('does not show the alternative overlay when eta <= alertTime', async () => {
    // Route duration (20 s) is within the alert time (30 s) — no alternative needed.
    mockEmergencyRoute.mockResolvedValue({
      polyline: [], steps: [], distanceM: 100, durationSec: 20,
      etaLabel: '0 min', distLabel: '100 m',
    });

    const { queryByText } = renderNavigate({ ...BASE_PARAMS });

    await waitFor(() =>
      expect(mockEmergencyRoute).toHaveBeenCalledTimes(1),
    );

    expect(queryByText(/אין מקלט בטווח/)).toBeNull();
    expect(queryByText(/שכבו על הקרקע/)).toBeNull();
  });

  it('hides entrance code after 5 minutes', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      json: () => Promise.resolve({ buildings: [APPROVED_BUILDING] }),
    });

    // Intercept only the 5-minute code-expiry timer, letting all other
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

    await waitFor(() =>
      getByText(`קוד כניסה: ${APPROVED_BUILDING.entranceCode}`),
    );

    act(() => codeExpireCallback?.());

    expect(queryByText(/קוד כניסה/)).toBeNull();
    expect(getByText('פג תוקף הקוד')).toBeTruthy();

    jest.restoreAllMocks();
  });
});
