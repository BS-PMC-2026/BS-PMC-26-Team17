import React from 'react';
import { render, waitFor, act } from '@testing-library/react-native';
import * as Location from 'expo-location';
import MapScreen from '../app/(tabs)/map';

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  reverseGeocodeAsync: jest.fn(() => Promise.resolve([])),
  geocodeAsync: jest.fn(() => Promise.resolve([])),
}));

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
}));

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: jest.fn(),
}));

jest.mock('@/context/auth', () => ({
  useAuth: () => ({ user: null }),
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

const mockLocation = Location as jest.Mocked<typeof Location>;

beforeEach(() => {
  jest.clearAllMocks();
  mockPostMessage.mockClear();
  webOnMessage = null;
  mockLocation.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' } as any);
  mockLocation.getCurrentPositionAsync.mockResolvedValue({
    coords: { latitude: 32.08, longitude: 34.78 },
  } as any);
});

const makeShelterFetch = (overrides: Record<string, unknown>) => {
  global.fetch = jest.fn(() =>
    Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          shelters: [
            {
              id: 'shelter-1',
              lat: 31.5,
              lng: 34.8,
              name: 'Test Shelter',
              address: 'Test Address',
              ...overrides,
            },
          ],
        }),
    } as Response),
  );
};

const emitReady = async () => {
  await act(async () => {
    webOnMessage?.({ nativeEvent: { data: JSON.stringify({ type: 'ready' }) } });
  });
};

const getShelterColor = (): string | undefined => {
  const msgs = mockPostMessage.mock.calls
    .map((c: any[]) => {
      try {
        return JSON.parse(c[0]);
      } catch {
        return null;
      }
    })
    .filter((m: any) => m && m.type === 'setShelters');
  if (msgs.length === 0) return undefined;
  const data = msgs[msgs.length - 1].data;
  return data && data.length > 0 ? data[0].color : undefined;
};

const renderAndReady = async () => {
  const utils = render(<MapScreen />);
  await waitFor(() => expect(webOnMessage).not.toBeNull());
  await emitReady();
  return utils;
};

describe('MapScreen integration - marker colors', () => {
  it('open shelter gets green marker (#1D9E75)', async () => {
    makeShelterFetch({ accessStatus: 'open' });
    await renderAndReady();
    await waitFor(() => expect(getShelterColor()).toBe('#1D9E75'));
  });

  it('closed shelter gets red marker (#E24B4A)', async () => {
    makeShelterFetch({ accessStatus: 'closed' });
    await renderAndReady();
    await waitFor(() => expect(getShelterColor()).toBe('#E24B4A'));
  });

  it('locked shelter gets red marker (#E24B4A)', async () => {
    makeShelterFetch({ accessStatus: 'locked' });
    await renderAndReady();
    await waitFor(() => expect(getShelterColor()).toBe('#E24B4A'));
  });

  it('full shelter gets yellow marker (#F5A623)', async () => {
    makeShelterFetch({ accessStatus: 'open', isFull: true });
    await renderAndReady();
    await waitFor(() => expect(getShelterColor()).toBe('#F5A623'));
  });

  it('shelter with shouldBeOpen false gets red marker (#E24B4A)', async () => {
    makeShelterFetch({ accessStatus: 'open', shouldBeOpen: false });
    await renderAndReady();
    await waitFor(() => expect(getShelterColor()).toBe('#E24B4A'));
  });
});

describe('MapScreen integration - legend', () => {
  it('renders the legend with three status items', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ shelters: [] }),
      } as Response),
    );
    const { findByText } = render(<MapScreen />);
    expect(await findByText('פתוח')).toBeTruthy();
    expect(await findByText('מלא')).toBeTruthy();
    expect(await findByText('סגור / נעול')).toBeTruthy();
  });
});
