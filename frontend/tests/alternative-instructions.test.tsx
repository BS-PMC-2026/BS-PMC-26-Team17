import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

/**
 * Tests for the alternative shelter / safety-instructions overlay in navigate.tsx.
 *
 * checkAlternativeNeeded runs after applyRoute when alertKind === 'siren'.
 * It compares etaSecondsRef.current against the zone's alert time and, when
 * the user can't make it in time, shows the overlay with either a building
 * entrance-code card or mode-specific safety instructions.
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
    haversineM:          jest.fn(() => 9999),
    formatDistance:      (m: number) => `${m} m`,
    formatDuration:      (s: number) => `${s} s`,
    calculateETA:        jest.fn(() => 0),
    distToPolyline:      () => Infinity,
    nearestPolylineIndex: () => 0,
    nearestStepIndex:    () => 0,
    isOffRoute:          () => false,
    stepInstruction:     () => '',
    remainingRoute:      (poly: any[]) => ({ polyline: poly, distanceM: 0 }),
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

const mockGetAlertTime =
  require('@/services/alertTimes').getAlertTime as jest.Mock;

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeAll(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

beforeEach(() => {
  jest.clearAllMocks();

  // Default: ETA (120 s) > alertTime (30 s) → overlay should appear.
  mockEmergencyRoute.mockResolvedValue({
    polyline: [], steps: [], distanceM: 500, durationSec: 120,
    etaLabel: '2 min', distLabel: '500 m',
  });
  mockGetAlertTime.mockReturnValue(30);

  // Default: no approved buildings → falls through to mode-specific text.
  (global.fetch as jest.Mock) = jest.fn(() =>
    Promise.resolve({
      json: () => Promise.resolve({ buildings: [] }),
    }),
  );
});

// ── Helper ────────────────────────────────────────────────────────────────────

/**
 * Renders the navigate screen with the given URL params.
 * fromLat / fromLng seed userLocation immediately so the emergency useEffect
 * fires on mount without waiting for real GPS resolution.
 */
const renderNavigate = (params: Record<string, string | undefined>) => {
  mockUseLocalSearchParams.mockReturnValue(params);
  const NavigateScreen = require('../app/navigate').default;
  return render(<NavigateScreen />);
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('navigate.tsx — alternative safety instructions', () => {
  it('shows driving instructions when eta > alertTime and no approved building (driving mode)', async () => {
    const { getByText } = renderNavigate({
      lat: '32.1', lng: '34.8', name: 'Shelter',
      emergency: 'true', mode: 'driving',
      alertKind: 'siren',
      fromLat: '32.0', fromLng: '34.7',
    });

    await waitFor(() =>
      getByText(/עצרו בצד הדרך/),
    );
  });

  it('shows walking instructions when eta > alertTime and no approved building (walking mode)', async () => {
    const { getByText } = renderNavigate({
      lat: '32.1', lng: '34.8', name: 'Shelter',
      emergency: 'true', mode: 'walking',
      alertKind: 'siren',
      fromLat: '32.0', fromLng: '34.7',
    });

    await waitFor(() =>
      getByText(/שכבו על הקרקע והגנו על הראש עם הידיים/),
    );
  });

  it('does not show the alternative overlay when eta <= alertTime', async () => {
    // Route duration (20 s) is within the alert time (30 s) — user can make
    // it to the shelter in time, so no alternative is needed.
    mockEmergencyRoute.mockResolvedValue({
      polyline: [], steps: [], distanceM: 100, durationSec: 20,
      etaLabel: '0 min', distLabel: '100 m',
    });

    const { queryByText } = renderNavigate({
      lat: '32.1', lng: '34.8', name: 'Shelter',
      emergency: 'true', mode: 'driving',
      alertKind: 'siren',
      fromLat: '32.0', fromLng: '34.7',
    });

    // Wait for the route fetch to complete so we know the check has run.
    await waitFor(() =>
      expect(mockEmergencyRoute).toHaveBeenCalledTimes(1),
    );

    expect(queryByText(/עצרו בצד הדרך/)).toBeNull();
    expect(queryByText(/שכבו על הקרקע/)).toBeNull();
  });
});
