import React from 'react';
import { render, waitFor, act } from '@testing-library/react-native';

/**
 * Verifies the navigate screen's "release reservation on unmount" wiring.
 *
 * The screen does a lot — WebView, Location, NavigationService — so we mock
 * those so the test stays focused on the cleanup useEffect that fires
 * ReservationService.release when the user backs out of /navigate during
 * a siren.
 */

// ── Mocks ────────────────────────────────────────────────────────────────────

// Captured so tests can simulate the user moving (drives advanceOnRoute).
let watchCallback: ((loc: any) => void) | null = null;

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted' })),
  getCurrentPositionAsync: jest.fn(() =>
    Promise.resolve({ coords: { latitude: 32, longitude: 34 } }),
  ),
  getLastKnownPositionAsync: jest.fn(() => Promise.resolve(null)),
  watchPositionAsync: jest.fn((_opts: any, cb: any) => {
    watchCallback = cb;
    return Promise.resolve({ remove: jest.fn() });
  }),
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

// NavigationService.haversineM is mockable per-test so arrival-detection
// tests can simulate "user is within 10m of dest". Typed with a rest-args
// signature so TS lets the wrapper spread its args through.
const mockHaversineM: jest.Mock<number, any[]> = jest.fn(() => 9999);

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
    haversineM: (...args: any[]) => mockHaversineM(...args),
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
const mockArrive: jest.Mock<Promise<any>, [any]> = jest.fn((_arg: any) =>
  Promise.resolve({
    shelter_id: 's1', promoted: true,
    reservedPlaces: 0, actualOccupancy: 1, capacity: 10, isFull: false,
  }),
);
jest.mock('@/services/ReservationService', () => ({
  ReservationService: {
    reserve: (arg: any) => mockReserve(arg),
    release: (arg: any) => mockRelease(arg),
    arrive:  (arg: any) => mockArrive(arg),
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
  mockHaversineM.mockReturnValue(9999);  // default: user nowhere near dest
  watchCallback = null;
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

  it('releases on unmount for PRE-ALARM too (no emergency=true)', async () => {
    // The release path used to be gated on isEmergency, which was wrong
    // — pre-alarm reservations also need to be released if the user backs
    // out. Verifies the ungating.
    const utils = renderNavigate({
      lat: '32.1', lng: '34.8', name: 'Test',
      // No emergency — this is the pre-alarm direct-navigate path.
      alertId: 'e1', alertKind: 'early', shelterId: 's1', initialGroupSize: '3',
    });

    utils.unmount();
    expect(mockRelease).toHaveBeenCalledTimes(1);
    expect(mockRelease).toHaveBeenCalledWith({
      shelterId: 's1', userId: 'user-1', alertId: 'e1',
    });
  });
});

describe('navigate.tsx — arrival detection', () => {
  it('does NOT POST /arrive when the user is still far from the destination', async () => {
    mockHaversineM.mockReturnValue(500);  // 500m away
    const utils = renderNavigate({
      lat: '32.1', lng: '34.8', name: 'Test',
      emergency: 'true', mode: 'walking',
      alertId: 'a1', alertKind: 'siren', shelterId: 's1', initialGroupSize: '1',
    });

    // Wait for the screen to settle into the navigating phase so the GPS
    // watcher subscribed.
    await waitFor(() => expect(watchCallback).not.toBeNull());

    // Simulate one GPS tick at 500m → advanceOnRoute → tryArrive(skip)
    await act(async () => {
      watchCallback!({ coords: { latitude: 31.9, longitude: 34.7 } });
    });

    expect(mockArrive).not.toHaveBeenCalled();
    utils.unmount();
  });

  it('POSTs /arrive once when the user crosses within 10m of the destination', async () => {
    // Default 9999m → no arrival on initial render.
    const utils = renderNavigate({
      lat: '32.1', lng: '34.8', name: 'Test',
      emergency: 'true', mode: 'walking',
      alertId: 'a1', alertKind: 'siren', shelterId: 's1', initialGroupSize: '1',
    });
    await waitFor(() => expect(watchCallback).not.toBeNull());

    // First tick at 50m — not arrived.
    mockHaversineM.mockReturnValue(50);
    await act(async () => {
      watchCallback!({ coords: { latitude: 32.0, longitude: 34.8 } });
    });
    expect(mockArrive).not.toHaveBeenCalled();

    // Second tick at 5m — should fire arrive exactly once.
    mockHaversineM.mockReturnValue(5);
    await act(async () => {
      watchCallback!({ coords: { latitude: 32.099, longitude: 34.8 } });
    });
    await waitFor(() => expect(mockArrive).toHaveBeenCalledTimes(1));
    expect(mockArrive).toHaveBeenCalledWith({
      shelterId: 's1', userId: 'user-1', alertId: 'a1',
    });

    // Third tick at 3m — must NOT re-fire (arrived already).
    mockHaversineM.mockReturnValue(3);
    await act(async () => {
      watchCallback!({ coords: { latitude: 32.0999, longitude: 34.8 } });
    });
    await waitFor(() => expect(mockArrive).toHaveBeenCalledTimes(1));

    utils.unmount();
  });

  it('does NOT release on unmount once the user has arrived', async () => {
    const utils = renderNavigate({
      lat: '32.1', lng: '34.8', name: 'Test',
      emergency: 'true', mode: 'walking',
      alertId: 'a1', alertKind: 'siren', shelterId: 's1', initialGroupSize: '1',
    });
    await waitFor(() => expect(watchCallback).not.toBeNull());

    // Trigger arrival.
    mockHaversineM.mockReturnValue(5);
    await act(async () => {
      watchCallback!({ coords: { latitude: 32.0999, longitude: 34.8 } });
    });
    await waitFor(() => expect(mockArrive).toHaveBeenCalledTimes(1));

    utils.unmount();
    expect(mockRelease).not.toHaveBeenCalled();
  });
});
