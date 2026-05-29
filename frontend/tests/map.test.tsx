import React from 'react';
import { render, waitFor, fireEvent, act } from '@testing-library/react-native';
import * as Location from 'expo-location';
import MapScreen from '../app/(tabs)/map';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  reverseGeocodeAsync: jest.fn(() => Promise.resolve([])),
  geocodeAsync: jest.fn(() => Promise.resolve([])),
}));

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
}));

// AsyncStorage is used by the map to load the user's home / radius settings.
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
}));

// useFocusEffect is invoked when the map gains focus to refresh the home circle.
// In tests we just no-op it — the relevant settings loading is exercised
// indirectly through the AsyncStorage mock above.
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: jest.fn(),
}));

// Auth context isn't relevant to the map's rendering tests, so stub it out.
jest.mock('@/context/auth', () => ({
  useAuth: () => ({ user: null }),
}));

// AlertsService polls oref.org.il every 3s — stub it so tests don't trigger
// real network calls (and don't inflate `fetch.mock.calls.length`).
jest.mock('@/services/AlertsService', () => ({
  AlertsService: {
    subscribe: jest.fn(() => () => {}),
    injectFakeAlert: jest.fn(),
  },
}));

// `postMessage` tracker — every message the screen sends into the WebView
const mockPostMessage = jest.fn();

// Holds the latest `onMessage` callback handed to the WebView. Tests
// invoke this directly to simulate events coming back from Leaflet.
let webOnMessage: ((event: any) => void) | null = null;

jest.mock('react-native-webview', () => {
  const React = require('react');
  const { View } = require('react-native');

  const MockWebView = React.forwardRef((props: any, ref: any) => {
    React.useImperativeHandle(ref, () => ({
      postMessage: mockPostMessage,
      injectJavaScript: jest.fn(),
    }));
    // Capture the callback so tests can drive the WebView
    webOnMessage = props.onMessage;
    return <View testID="map-webview" {...props} />;
  });

  return { WebView: MockWebView };
});

// Silence console.error / console.warn from intentional error paths
beforeAll(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

const mockLocation = Location as jest.Mocked<typeof Location>;

const grantLocation = (lat = 32.08, lng = 34.78) => {
  mockLocation.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' } as any);
  mockLocation.getCurrentPositionAsync.mockResolvedValue({
    coords: { latitude: lat, longitude: lng },
  } as any);
};

// Simulate the WebView dispatching a message back to React Native.
const emitFromWeb = async (data: any) => {
  await act(async () => {
    webOnMessage?.({ nativeEvent: { data: JSON.stringify(data) } });
  });
};

// Simulate a tap on the map at (lat,lng) — Leaflet sends a 'mapClick' message
const tapMap = (lat = 31.5, lng = 34.8) => emitFromWeb({ type: 'mapClick', lat, lng });

// Returns a fetch mock whose responses cycle through the provided list.
const makeFetchSequence = (...responses: any[]) => {
  let i = 0;
  return jest.fn(() => {
    const body = responses[Math.min(i++, responses.length - 1)];
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
  });
};

const makeFetchWithShelters = (shelters: any[]) =>
  makeFetchSequence({ shelters, count: shelters.length });

const SHELTER_A = {
  lat: 31.25, lng: 34.79,
  name: 'מקלט גן העצמאות',
  address: 'רחוב הרצל 1',
  accessStatus: 'open',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockPostMessage.mockClear();
  webOnMessage = null;
  global.fetch = jest.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ shelters: [], count: 0 }),
    } as Response),
  ) as jest.Mock;
});

// Helper — find postMessage calls of a given `type`
const messagesOfType = (type: string) =>
  mockPostMessage.mock.calls
    .map(c => { try { return JSON.parse(c[0]); } catch { return null; } })
    .filter(m => m && m.type === type);

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('MapScreen', () => {

  // 1 ── Loading
  it('shows loading screen before location is received', () => {
    mockLocation.requestForegroundPermissionsAsync.mockReturnValue(new Promise(() => {}));
    const { getByText } = render(<MapScreen />);
    expect(getByText('Locating...')).toBeTruthy();
  });

  // 2 ── Permission granted → WebView mounts
  it('shows the WebView map once location is granted', async () => {
    grantLocation();
    const { getByTestId } = render(<MapScreen />);
    await waitFor(() => expect(getByTestId('map-webview')).toBeTruthy());
  });

  // 3 ── Permission denied → WebView still shows, no 📍 button
  it('shows the map without 📍 button when permission denied', async () => {
    mockLocation.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' } as any);
    const { getByTestId, queryByText } = render(<MapScreen />);
    await waitFor(() => expect(getByTestId('map-webview')).toBeTruthy());
    expect(queryByText('📍')).toBeNull();
  });

  // 4 ── mapClick from the WebView → pin coordinates flow into RN state
  it('a mapClick message stores the tapped coordinates as a pin', async () => {
    grantLocation();
    const { getByTestId, findByText } = render(<MapScreen />);
    await waitFor(() => getByTestId('map-webview'));
    await tapMap(31.12345, 34.98765);
    expect(await findByText('31.12345, 34.98765')).toBeTruthy();
  });

  // 5 ── Tap map → bottom panel appears with Navigate button
  it('tapping the map shows a bottom panel with a navigate button', async () => {
    grantLocation();
    const { getByTestId, getByText } = render(<MapScreen />);
    await waitFor(() => getByTestId('map-webview'));
    await tapMap();
    expect(getByText(/Navigate/i)).toBeTruthy();
  });

  // 6 ── Panel shows fallback coords when reverseGeocode returns nothing
  it('the panel shows fallback coords when reverseGeocode returns nothing', async () => {
    grantLocation();
    (mockLocation.reverseGeocodeAsync as jest.Mock).mockResolvedValue([]);
    const { getByTestId, findByText } = render(<MapScreen />);
    await waitFor(() => getByTestId('map-webview'));
    await tapMap(31.12345, 34.98765);
    expect(await findByText('31.12345, 34.98765')).toBeTruthy();
  });

  // 7 ── Navigate button → router.push with correct lat/lng
  it('navigate button calls router.push with correct lat and lng', async () => {
    grantLocation();
    const { router } = require('expo-router');
    const { getByTestId, getByText } = render(<MapScreen />);
    await waitFor(() => getByTestId('map-webview'));
    await tapMap(31.5, 34.8);
    fireEvent.press(getByText(/Navigate/i));
    expect(router.push).toHaveBeenCalledWith(expect.stringContaining('lat=31.5'));
    expect(router.push).toHaveBeenCalledWith(expect.stringContaining('lng=34.8'));
  });

  // 8 ── ✕ closes the tap panel
  it('tapping ✕ closes the panel', async () => {
    grantLocation();
    const { getByTestId, getByText, queryByText } = render(<MapScreen />);
    await waitFor(() => getByTestId('map-webview'));
    await tapMap();
    expect(getByText(/Navigate/i)).toBeTruthy();
    fireEvent.press(getByText('✕'));
    expect(queryByText(/Navigate/i)).toBeNull();
  });

  // 9 ── Second tap replaces the first pin's coordinates
  it('second tap replaces the existing pin coordinates', async () => {
    grantLocation();
    const { getByTestId, findByText } = render(<MapScreen />);
    await waitFor(() => getByTestId('map-webview'));
    await tapMap(31.1, 34.1);
    await tapMap(32.2, 35.2);
    expect(await findByText('32.20000, 35.20000')).toBeTruthy();
  });

  // 10 ── 📍 button sends a flyTo message to the WebView
  it('📍 button sends a flyTo message with the user location', async () => {
    grantLocation(32.08, 34.78);
    const { getByText } = render(<MapScreen />);
    await waitFor(() => getByText('📍'));
    mockPostMessage.mockClear();
    fireEvent.press(getByText('📍'));
    const flyMessages = messagesOfType('flyTo');
    expect(flyMessages).toContainEqual(
      expect.objectContaining({ lat: 32.08, lng: 34.78 }),
    );
  });
});

// ─── Search feature edge cases ────────────────────────────────────────────────

describe('Search feature', () => {

  // 11 ── Exact shelter name → navigates to /shelter-details
  it('searching by exact shelter name navigates to /shelter-details', async () => {
    global.fetch = makeFetchWithShelters([SHELTER_A]);
    grantLocation();
    const { router } = require('expo-router');
    const { getByTestId } = render(<MapScreen />);
    await waitFor(() => getByTestId('map-webview'));

    fireEvent.changeText(getByTestId('search-input'), 'מקלט גן העצמאות');
    await act(async () => { fireEvent.press(getByTestId('search-button')); });

    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith(expect.stringContaining('/shelter-details')),
    );
    expect(router.push).toHaveBeenCalledWith(expect.stringContaining('lat=31.25'));
    expect(messagesOfType('flyTo')).toContainEqual(
      expect.objectContaining({ lat: 31.25, lng: 34.79 }),
    );
  });

  // 12 ── Partial match (substring) → still finds the shelter
  it('partial name match navigates to /shelter-details', async () => {
    global.fetch = makeFetchWithShelters([SHELTER_A]);
    grantLocation();
    const { router } = require('expo-router');
    const { getByTestId } = render(<MapScreen />);
    await waitFor(() => getByTestId('map-webview'));

    fireEvent.changeText(getByTestId('search-input'), 'גן העצמאות');
    await act(async () => { fireEvent.press(getByTestId('search-button')); });

    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith(expect.stringContaining('/shelter-details')),
    );
  });

  // 13 ── Search by shelter address → finds the shelter (not Nominatim)
  it('searching by shelter address navigates without calling Nominatim', async () => {
    global.fetch = makeFetchWithShelters([SHELTER_A]);
    grantLocation();
    const { router } = require('expo-router');
    const { getByTestId } = render(<MapScreen />);
    await waitFor(() => getByTestId('map-webview'));

    fireEvent.changeText(getByTestId('search-input'), 'הרצל 1');
    await act(async () => { fireEvent.press(getByTestId('search-button')); });

    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith(expect.stringContaining('/shelter-details')),
    );
    // Only the shelters API was hit — Nominatim was never called
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(1);
  });

  // 14 ── No shelter match → falls back to Nominatim and shows a pin
  it('when no shelter matches, falls back to Nominatim and shows a pin', async () => {
    global.fetch = makeFetchSequence(
      { shelters: [SHELTER_A], count: 1 },
      [{ lat: '32.0', lon: '34.9', display_name: 'תל אביב, ישראל' }],
    );
    grantLocation();
    const { getByTestId, findByText } = render(<MapScreen />);
    await waitFor(() => getByTestId('map-webview'));

    fireEvent.changeText(getByTestId('search-input'), 'תל אביב');
    await act(async () => { fireEvent.press(getByTestId('search-button')); });

    expect(await findByText('תל אביב, ישראל')).toBeTruthy();
    expect(messagesOfType('flyTo')).toContainEqual(
      expect.objectContaining({ lat: 32.0, lng: 34.9 }),
    );
  });

  // 15 ── Empty / whitespace-only query → does nothing
  it('empty or whitespace search query does nothing', async () => {
    grantLocation();
    const { getByTestId } = render(<MapScreen />);
    await waitFor(() => getByTestId('map-webview'));

    mockPostMessage.mockClear();
    fireEvent.changeText(getByTestId('search-input'), '   ');
    await act(async () => { fireEvent.press(getByTestId('search-button')); });

    expect(messagesOfType('flyTo')).toHaveLength(0);
  });

  // 16 ── Nominatim returns empty array → no crash, no pin, no panel
  it('Nominatim returning no results does not crash or show a pin', async () => {
    global.fetch = makeFetchSequence(
      { shelters: [], count: 0 },
      [],
    );
    grantLocation();
    const { getByTestId, queryByText } = render(<MapScreen />);
    await waitFor(() => getByTestId('map-webview'));

    mockPostMessage.mockClear();
    fireEvent.changeText(getByTestId('search-input'), 'כתובת לא קיימת');
    await act(async () => { fireEvent.press(getByTestId('search-button')); });

    expect(messagesOfType('flyTo')).toHaveLength(0);
    expect(queryByText(/Navigate/i)).toBeNull();
    expect(getByTestId('map-webview')).toBeTruthy();
  });

  // 17 ── Nominatim network error → no crash
  it('Nominatim network error does not crash the app', async () => {
    let call = 0;
    global.fetch = jest.fn(() => {
      call++;
      if (call === 1)
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ shelters: [], count: 0 }) } as Response);
      return Promise.reject(new Error('Network error'));
    });
    grantLocation();
    const { getByTestId } = render(<MapScreen />);
    await waitFor(() => getByTestId('map-webview'));

    fireEvent.changeText(getByTestId('search-input'), 'כתובת לא קיימת');
    await act(async () => { fireEvent.press(getByTestId('search-button')); });

    expect(getByTestId('map-webview')).toBeTruthy();
  });

  // 18 ── Pressing Enter triggers search (same as tapping the button)
  it('pressing Enter on the search input triggers the search', async () => {
    global.fetch = makeFetchWithShelters([SHELTER_A]);
    grantLocation();
    const { router } = require('expo-router');
    const { getByTestId } = render(<MapScreen />);
    await waitFor(() => getByTestId('map-webview'));

    fireEvent.changeText(getByTestId('search-input'), 'גן העצמאות');
    await act(async () => { fireEvent(getByTestId('search-input'), 'submitEditing'); });

    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith(expect.stringContaining('/shelter-details')),
    );
  });

  // 19 ── ✕ button clears the search input
  it('✕ button clears the search input', async () => {
    global.fetch = makeFetchSequence(
      { shelters: [], count: 0 },
      [{ lat: '32.0', lon: '34.9', display_name: 'תל אביב, ישראל' }],
    );
    grantLocation();
    const { getByTestId, findByText } = render(<MapScreen />);
    await waitFor(() => getByTestId('map-webview'));

    fireEvent.changeText(getByTestId('search-input'), 'תל אביב');
    await act(async () => { fireEvent.press(getByTestId('search-button')); });
    expect(await findByText('תל אביב, ישראל')).toBeTruthy();

    fireEvent.press(getByTestId('search-clear'));
    expect(getByTestId('search-input').props.value).toBe('');
  });

  // 20 ── Multiple shelters: picks the first match
  it('with multiple shelters, the first name match is selected', async () => {
    const shelterB = { lat: 31.3, lng: 34.8, name: 'מקלט גן לאומי', address: 'רחוב 2' };
    global.fetch = makeFetchWithShelters([SHELTER_A, shelterB]);
    grantLocation();
    const { router } = require('expo-router');
    const { getByTestId } = render(<MapScreen />);
    await waitFor(() => getByTestId('map-webview'));

    fireEvent.changeText(getByTestId('search-input'), 'מקלט גן העצמאות');
    await act(async () => { fireEvent.press(getByTestId('search-button')); });

    // Should navigate to /shelter-details for SHELTER_A specifically
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith(expect.stringContaining('lat=31.25')),
    );
    expect(messagesOfType('flyTo')).toContainEqual(
      expect.objectContaining({ lat: 31.25, lng: 34.79 }),
    );
  });
});

// ─── Gear shortcut to Settings ────────────────────────────────────────────────

describe('Gear shortcut', () => {
  it('tapping ⚙️ navigates to the Settings screen', async () => {
    grantLocation();
    const { router } = require('expo-router');
    const { getByTestId } = render(<MapScreen />);
    await waitFor(() => getByTestId('map-webview'));

    fireEvent.press(getByTestId('gear-button'));
    expect(router.push).toHaveBeenCalledWith(expect.stringContaining('/settings'));
  });
});

// ─── Admin visibility filtering (isActive / isVisibleOnMap) ──────────────────

describe('Admin visibility filtering', () => {
  // Helper — returns the latest setShelters payload that flowed into the WebView.
  const lastSetShelters = () => {
    const msgs = messagesOfType('setShelters');
    return msgs[msgs.length - 1]?.data ?? [];
  };

  it('hides shelters flagged as isActive=false', async () => {
    const visible  = { ...SHELTER_A, name: 'Visible',  id: 'v1' };
    const inactive = { ...SHELTER_A, name: 'Inactive', id: 'i1', isActive: false };
    global.fetch = makeFetchWithShelters([visible, inactive]);
    grantLocation();
    const { getByTestId } = render(<MapScreen />);
    await waitFor(() => getByTestId('map-webview'));
    // setShelters is gated on webReady; emit the ready event from the WebView.
    await emitFromWeb({ type: 'ready' });

    await waitFor(() => expect(lastSetShelters().length).toBe(1));
    expect(lastSetShelters().map((s: any) => s.id)).toEqual(['v1']);
  });

  it('hides shelters flagged as isVisibleOnMap=false', async () => {
    const visible = { ...SHELTER_A, name: 'Visible', id: 'v2' };
    const hidden  = { ...SHELTER_A, name: 'Hidden',  id: 'h2', isVisibleOnMap: false };
    global.fetch = makeFetchWithShelters([visible, hidden]);
    grantLocation();
    const { getByTestId } = render(<MapScreen />);
    await waitFor(() => getByTestId('map-webview'));
    await emitFromWeb({ type: 'ready' });

    await waitFor(() => expect(lastSetShelters().length).toBe(1));
    expect(lastSetShelters().map((s: any) => s.id)).toEqual(['v2']);
  });

  it('shows shelters when isActive/isVisibleOnMap are absent (back-compat)', async () => {
    // Neither flag set — should still be rendered.
    const a = { ...SHELTER_A, name: 'A', id: 'a' };
    const b = { ...SHELTER_A, name: 'B', id: 'b' };
    global.fetch = makeFetchWithShelters([a, b]);
    grantLocation();
    const { getByTestId } = render(<MapScreen />);
    await waitFor(() => getByTestId('map-webview'));
    await emitFromWeb({ type: 'ready' });

    await waitFor(() => expect(lastSetShelters().length).toBe(2));
  });
});
