/**
 * Integration tests for BSPMT17-351 — the centralized main screen.
 *
 * Covers the full flow end-to-end through real components and the real
 * AuthProvider: index redirects to map, the ⚙️ shortcut on the map
 * navigates to Settings, Settings exposes Back / Logout / Admin → Dashboard,
 * and ShelterDashboard exposes Back. Only the network boundary
 * (`global.fetch`), `expo-router`, and the `WebView` (which is a heavy
 * native module unfit for jest) are stubbed.
 */
import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';

// ─── Mocks shared by every test in this file ─────────────────────────────────

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
jest.mock('expo-router', () => {
  const React = require('react');
  return {
    router: {
      push: (...args: unknown[]) => mockPush(...args),
      replace: (...args: unknown[]) => mockReplace(...args),
      back: (...args: unknown[]) => mockBack(...args),
    },
    // Render a tiny stand-in so we can detect the redirect at test time
    Redirect: ({ href }: { href: string }) => {
      const { Text } = require('react-native');
      return <Text testID="redirect">{href}</Text>;
    },
    useLocalSearchParams: () => ({}),
  };
});

// AsyncStorage — the official jest mock from the package
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// useFocusEffect from react-navigation runs the effect immediately in tests.
// Without this stub it would silently skip, leaving state at defaults.
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb: () => void | (() => void)) => {
    const React = require('react');
    React.useEffect(() => cb(), []);
  },
}));

// WebView — render a plain View so the map screen mounts in jsdom-free RN.
jest.mock('react-native-webview', () => {
  const React = require('react');
  const { View } = require('react-native');
  const MockWebView = React.forwardRef((props: any, ref: any) => {
    React.useImperativeHandle(ref, () => ({
      postMessage: jest.fn(),
      injectJavaScript: jest.fn(),
    }));
    return <View testID="map-webview" {...props} />;
  });
  return { WebView: MockWebView };
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// expo-notifications is pulled in transitively via the auth context. The
// package isn't installed in the test env yet, so we stub the whole module.
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync:    jest.fn(() => Promise.resolve({ status: 'granted' })),
  requestPermissionsAsync:jest.fn(() => Promise.resolve({ status: 'granted' })),
  getExpoPushTokenAsync:  jest.fn(() => Promise.resolve({ data: 'mock-token' })),
  scheduleNotificationAsync: jest.fn(),
  AndroidImportance: { MAX: 5 },
  setNotificationChannelAsync: jest.fn(),
}), { virtual: true });
jest.mock('expo-constants', () => ({
  default: { expoConfig: { extra: {} } },
  expoConfig: { extra: {} },
}), { virtual: true });

// AlertsService — stub so it doesn't try to poll oref.org.il during tests.
jest.mock('@/services/AlertsService', () => ({
  AlertsService: {
    subscribe: jest.fn(() => () => {}),
    injectFakeAlert: jest.fn(),
  },
}));

// expo-location — provide a granted location so the map mounts past `loading`.
jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(() =>
    Promise.resolve({ status: 'granted' }),
  ),
  getCurrentPositionAsync: jest.fn(() =>
    Promise.resolve({ coords: { latitude: 31.25, longitude: 34.79 } }),
  ),
  watchPositionAsync: jest.fn(() => Promise.resolve({ remove: jest.fn() })),
  Accuracy: { High: 4, Balanced: 3 },
  reverseGeocodeAsync: jest.fn(() => Promise.resolve([])),
}));

// Real components under test (imported AFTER the mocks above).
import HomeIndex from '../app/(tabs)/index';
import MapScreen from '../app/(tabs)/map';
import SettingsScreen from '../app/(tabs)/settings';
import ShelterDashboard from '../app/(tabs)/ShelterDashboard';
import { AuthProvider, useAuth } from '../context/auth';

// Helper — wraps a screen with AuthProvider and seeds a user (so screens
// that gate on auth render their authenticated state).
function SeedUser({
  role,
  children,
}: {
  role: 'admin' | 'user';
  children: React.ReactNode;
}) {
  const { login } = useAuth();
  React.useEffect(() => {
    login({
      id: 'u1',
      email: 'a@b.com',
      name: 'Alice',
      role,
      telephone: '050',
    });
  }, []);
  return <>{children}</>;
}

function renderWithAuth(role: 'admin' | 'user', node: React.ReactElement) {
  return render(
    <AuthProvider>
      <SeedUser role={role}>{node}</SeedUser>
    </AuthProvider>,
  );
}

beforeEach(() => {
  mockPush.mockClear();
  mockReplace.mockClear();
  mockBack.mockClear();
  // Most map calls return an empty shelter list — keeps tests deterministic.
  (global.fetch as jest.Mock) = jest.fn(() =>
    Promise.resolve({
      ok: true,
      json: async () => ({ shelters: [], count: 0 }),
    } as Response),
  );
});

describe('Main screen integration (BSPMT17-351)', () => {

  // ── Index → Map redirect ──────────────────────────────────────────────────
  it('the (tabs) index immediately redirects to /(tabs)/map', () => {
    const { getByTestId } = render(<HomeIndex />);
    expect(getByTestId('redirect').props.children).toBe('/(tabs)/map');
  });

  // ── Map → Settings via the gear button ────────────────────────────────────
  it('tapping the ⚙️ on the map navigates to the Settings screen', async () => {
    const { getByTestId } = renderWithAuth('user', <MapScreen />);
    await waitFor(() => getByTestId('map-webview'));

    fireEvent.press(getByTestId('gear-button'));

    expect(mockPush).toHaveBeenCalledWith(
      expect.stringContaining('/(tabs)/settings'),
    );
  });

  // ── Settings: Back button → router.back ───────────────────────────────────
  it('tapping the Back button in Settings calls router.back', async () => {
    const { getByTestId } = renderWithAuth('user', <SettingsScreen />);
    await waitFor(() => getByTestId('back-button'));

    fireEvent.press(getByTestId('back-button'));

    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  // ── Settings: Logout button clears the authenticated user ────────────────
  it('tapping Logout in Settings signs the user out via AuthProvider', async () => {
    function Wrapper() {
      const { isLoggedIn } = useAuth();
      return (
        <>
          <SettingsScreen />
          {/* Reflect the auth state into the DOM so the assertion is observable */}
          <SeedUserDisplay loggedIn={isLoggedIn} />
        </>
      );
    }

    function SeedUserDisplay({ loggedIn }: { loggedIn: boolean }) {
      const { Text } = require('react-native');
      return <Text testID="auth-state">{loggedIn ? 'in' : 'out'}</Text>;
    }

    const { getByTestId } = renderWithAuth('user', <Wrapper />);
    // Wait until the seeded login is reflected.
    await waitFor(() => expect(getByTestId('auth-state').props.children).toBe('in'));

    await act(async () => {
      fireEvent.press(getByTestId('logout-button'));
    });

    await waitFor(() =>
      expect(getByTestId('auth-state').props.children).toBe('out'),
    );
  });

  // ── Settings: Admin section visibility ───────────────────────────────────
  it('hides the Admin section for regular users', async () => {
    const { queryByTestId } = renderWithAuth('user', <SettingsScreen />);
    // Give the component a tick to mount and read the user role.
    await waitFor(() => expect(queryByTestId('back-button')).toBeTruthy());
    expect(queryByTestId('shelter-dashboard-button')).toBeNull();
  });

  it('shows the Shelter Dashboard shortcut for admins', async () => {
    const { findByTestId } = renderWithAuth('admin', <SettingsScreen />);
    expect(await findByTestId('shelter-dashboard-button')).toBeTruthy();
  });

  // ── Settings → Shelter Dashboard ─────────────────────────────────────────
  it('tapping the admin Shelter Dashboard button navigates to the dashboard route', async () => {
    const { findByTestId } = renderWithAuth('admin', <SettingsScreen />);
    const btn = await findByTestId('shelter-dashboard-button');

    fireEvent.press(btn);

    expect(mockPush).toHaveBeenCalledWith(
      expect.stringContaining('/(tabs)/ShelterDashboard'),
    );
  });

  // ── ShelterDashboard Back button ──────────────────────────────────────────
  it('tapping Back in the Shelter Dashboard calls router.back', async () => {
    const { findByTestId } = renderWithAuth('admin', <ShelterDashboard />);
    const back = await findByTestId('back-button');

    fireEvent.press(back);

    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});
