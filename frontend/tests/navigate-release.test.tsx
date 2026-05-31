import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

/**
 * Verifies the navigate screen's "release reservation on unmount" wiring.
 *
 * The screen does a lot — WebView, Location, NavigationService — so we mock
 * those so the test stays focused on the cleanup useEffect that fires
 * ReservationService.release when the user backs out of /navigate during
 * a siren.
 */

// ── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted' })),
  getCurrentPositionAsync: jest.fn(() =>
    Promise.resolve({ coords: { latitude: 32, longitude: 34 } }),
  ),
  getLastKnownPositionAsync: jest.fn(() => Promise.resolve(null)),
  watchPositionAsync: jest.fn(() => Promise.resolve({ remove: jest.fn() })),
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
    React.useImperativeHandle(ref, () => ({ postMessage: jest.fn(), injectJavaScript: jest.fn() }));
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
        polyline: [], steps: [], distanceM: 0, durationSec: 0,
        etaLabel: '0 min', distLabel: '0 m',
      }),
    ),
    haversineM: () => 0,
    formatDistance: (m: number) => `${m} m`,
    formatDuration: (s: number) => `${s} s`,
    calculateETA: () => 0,
    distToPolyline: () => Infinity,
    nearestPolylineIndex: () => 0,
    nearestStepIndex: () => 0,
    isOffRoute: () => false,
    stepInstruction: () => '',
    remainingRoute: (poly: any[]) => ({ polyline: poly, distanceM: 0 }),
  },
}));

// Typed with the call signature so .mock.calls[i][0] is typed.
const mockRelease: jest.Mock<Promise<any>, [any]> = jest.fn((_arg: any) =>
  Promise.resolve({}),
);
const mockReserve: jest.Mock<Promise<any>, [any]> = jest.fn((_arg: any) =>
  Promise.resolve({
    reservation_id: 'r1', shelter_id: 's1', reservedPlaces: 1,
    actualOccupancy: 0, capacity: 10, isFull: false, expiresAt: 'x',
  }),
);
jest.mock('@/services/ReservationService', () => ({
  ReservationService: {
    reserve: (arg: any) => mockReserve(arg),
    release: (arg: any) => mockRelease(arg),
  },
}));

jest.mock('@/context/auth', () => ({
  useAuth: () => ({ user: { id: 'user-1', email: 'u@x.com', name: 'U', role: 'user' } }),
}));

const mockUseLocalSearchParams = require('expo-router').useLocalSearchParams as jest.Mock;

// Silence noisy console warnings from intentional error paths.
beforeAll(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

beforeEach(() => {
  jest.clearAllMocks();
});

// ── Helper ────────────────────────────────────────────────────────────────────

const renderNavigate = (params: Record<string, string | undefined>) => {
  mockUseLocalSearchParams.mockReturnValue(params);
  // Late require so the mocks above are in place before navigate.tsx is loaded.
  const NavigateScreen = require('../app/navigate').default;
  return render(<NavigateScreen />);
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe('navigate.tsx — release on unmount', () => {
  it('fires ReservationService.release on unmount when in emergency mode with reservation context', async () => {
    const utils = renderNavigate({
      lat: '32.1', lng: '34.8', name: 'Test',
      emergency: 'true', mode: 'walking',
      alertId: 'a1', alertKind: 'siren', shelterId: 's1', initialGroupSize: '1',
    });
    // Wait for the screen to settle. The mocked emergencyRoute resolves immediately.
    await waitFor(() => expect(mockReserve).toHaveBeenCalledTimes(0));  // navigate.tsx itself doesn't reserve

    utils.unmount();

    expect(mockRelease).toHaveBeenCalledTimes(1);
    expect(mockRelease).toHaveBeenCalledWith({
      shelterId: 's1',
      userId:    'user-1',
      alertId:   'a1',
    });
  });

  it('does NOT release on unmount when reservation context is missing (non-siren navigation)', async () => {
    const utils = renderNavigate({
      lat: '32.1', lng: '34.8', name: 'Test',
      // No emergency, no alertId / shelterId — a regular user-picked navigation.
    });

    utils.unmount();
    expect(mockRelease).not.toHaveBeenCalled();
  });

  it('does NOT release on unmount when emergency=true but alertId is missing', async () => {
    const utils = renderNavigate({
      lat: '32.1', lng: '34.8', name: 'Test',
      emergency: 'true', mode: 'walking',
      // No alertId / shelterId — degenerate case, should be safe.
    });

    utils.unmount();
    expect(mockRelease).not.toHaveBeenCalled();
  });
});
