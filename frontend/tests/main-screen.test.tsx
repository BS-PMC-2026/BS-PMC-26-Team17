/**
 * Unit tests for BSPMT17-351 — small, isolated checks on each piece of the
 * "centralized main screen" feature: the index redirect, the ⚙️ shortcut on
 * the map, the Back / Logout / Admin buttons in Settings, and the Back button
 * on ShelterDashboard.
 *
 * Unlike `__tests__/main-screen.integration.test.tsx`, this file stubs
 * AuthProvider, expo-router and other heavy modules at the call boundary —
 * each test exercises one specific element with the rest of the world inert.
 */
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

// ─── Shared mocks ────────────────────────────────────────────────────────────

const mockPush = jest.fn();
const mockBack = jest.fn();

jest.mock('expo-router', () => {
  const React = require('react');
  return {
    router: {
      push: (...args: unknown[]) => mockPush(...args),
      back: (...args: unknown[]) => mockBack(...args),
      replace: jest.fn(),
    },
    Redirect: ({ href }: { href: string }) => {
      const { Text } = require('react-native');
      return <Text testID="redirect">{href}</Text>;
    },
    useLocalSearchParams: () => ({}),
  };
});

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
}));

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb: () => void | (() => void)) => {
    const React = require('react');
    React.useEffect(() => cb(), []);
  },
}));

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

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(() =>
    Promise.resolve({ status: 'granted' }),
  ),
  getCurrentPositionAsync: jest.fn(() =>
    Promise.resolve({ coords: { latitude: 31.25, longitude: 34.79 } }),
  ),
  reverseGeocodeAsync: jest.fn(() => Promise.resolve([])),
}));

// useAuth is mocked per-test so we can swap the user role on demand.
const mockLogout = jest.fn();
let mockUser: { id: string; role: string } | null = { id: 'u1', role: 'user' };
jest.mock('@/context/auth', () => ({
  useAuth: () => ({ user: mockUser, logout: mockLogout, login: jest.fn() }),
}));

// Silence intentional warnings (Nominatim/fetch are not used here).
beforeAll(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

beforeEach(() => {
  mockPush.mockClear();
  mockBack.mockClear();
  mockLogout.mockClear();
  mockUser = { id: 'u1', role: 'user' };
  (global.fetch as jest.Mock) = jest.fn(() =>
    Promise.resolve({
      ok: true,
      json: async () => ({ shelters: [], count: 0 }),
    } as Response),
  );
});

// Components under test (imported lazily inside each describe so jest can
// re-evaluate after mockUser is swapped).
import HomeIndex from '../app/(tabs)/index';
import MapScreen from '../app/(tabs)/map';
import SettingsScreen from '../app/(tabs)/settings';
import ShelterDashboard from '../app/(tabs)/ShelterDashboard';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('HomeIndex (redirect)', () => {
  it('renders a Redirect pointing at /(tabs)/map', () => {
    const { getByTestId } = render(<HomeIndex />);
    expect(getByTestId('redirect').props.children).toBe('/(tabs)/map');
  });
});

describe('MapScreen — gear shortcut', () => {
  it('renders the ⚙️ button once the map is mounted', async () => {
    const { findByTestId } = render(<MapScreen />);
    expect(await findByTestId('gear-button')).toBeTruthy();
  });

  it('pushes /(tabs)/settings when the ⚙️ button is pressed', async () => {
    const { findByTestId } = render(<MapScreen />);
    const gear = await findByTestId('gear-button');

    fireEvent.press(gear);

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush.mock.calls[0][0]).toContain('/(tabs)/settings');
  });
});

describe('SettingsScreen — Back / Logout / Admin', () => {
  it('renders the Back button and calls router.back when pressed', async () => {
    const { findByTestId } = render(<SettingsScreen />);
    const back = await findByTestId('back-button');

    fireEvent.press(back);

    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('renders the Logout button and calls useAuth().logout when pressed', async () => {
    const { findByTestId } = render(<SettingsScreen />);
    const logout = await findByTestId('logout-button');

    fireEvent.press(logout);

    expect(mockLogout).toHaveBeenCalledTimes(1);
  });

  it('hides the admin Shelter Dashboard button for regular users', async () => {
    mockUser = { id: 'u1', role: 'user' };
    const { queryByTestId, findByTestId } = render(<SettingsScreen />);
    await findByTestId('back-button'); // wait for mount
    expect(queryByTestId('shelter-dashboard-button')).toBeNull();
  });

  it('shows the admin Shelter Dashboard button for admins', async () => {
    mockUser = { id: 'u1', role: 'admin' };
    const { findByTestId } = render(<SettingsScreen />);
    expect(await findByTestId('shelter-dashboard-button')).toBeTruthy();
  });

  it('pushes /(tabs)/ShelterDashboard when the admin button is pressed', async () => {
    mockUser = { id: 'u1', role: 'admin' };
    const { findByTestId } = render(<SettingsScreen />);
    const btn = await findByTestId('shelter-dashboard-button');

    fireEvent.press(btn);

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush.mock.calls[0][0]).toContain('/(tabs)/ShelterDashboard');
  });
});

describe('ShelterDashboard — Back button', () => {
  it('renders the Back button and calls router.back when pressed', async () => {
    mockUser = { id: 'u1', role: 'admin' };
    const { findByTestId } = render(<ShelterDashboard />);
    const back = await findByTestId('back-button');

    fireEvent.press(back);

    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});
