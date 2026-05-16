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

const mockAnimateToRegion = jest.fn();

jest.mock('react-native-maps', () => {
  const React = require('react');
  const { View } = require('react-native');

  const MockMapView = React.forwardRef((props: any, ref: any) => {
    React.useImperativeHandle(ref, () => ({ animateToRegion: mockAnimateToRegion }));
    return <View testID="map-view" {...props} />;
  });

  const MockMarker = ({ coordinate, pinColor }: any) => (
    <View
      testID={pinColor === '#1a73e8' ? 'tap-marker' : 'map-marker'}
      accessibilityLabel={`${coordinate.latitude},${coordinate.longitude}`}
    />
  );

  return {
    __esModule: true,
    default: MockMapView,
    Marker: MockMarker,
    // The home-radius circle is just visual — render nothing in tests.
    Circle: () => null,
    PROVIDER_DEFAULT: null,
  };
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

const tapMap = (element: any, lat = 31.5, lng = 34.8) =>
  fireEvent.press(element, { nativeEvent: { coordinate: { latitude: lat, longitude: lng } } });

// Returns a fetch mock whose responses cycle through the provided list.
// The last entry repeats for any extra calls.
const makeFetchSequence = (...responses: any[]) => {
  let i = 0;
  return jest.fn(() => {
    const body = responses[Math.min(i++, responses.length - 1)];
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
  });
};

// Shorthand: shelters load returns the given list, all other calls fail gracefully.
const makeFetchWithShelters = (shelters: any[]) =>
  makeFetchSequence({ shelters, count: shelters.length });

// A single shelter fixture used across search tests
const SHELTER_A = {
  lat: 31.25, lng: 34.79,
  name: 'מקלט גן העצמאות',
  address: 'רחוב הרצל 1',
  accessStatus: 'open',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockAnimateToRegion.mockClear();
  // Default: fetch returns empty shelters list so the shelter-load effect succeeds
  global.fetch = jest.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ shelters: [], count: 0 }),
    } as Response),
  ) as jest.Mock;
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('MapScreen', () => {

  // 1 ── Loading
  it('shows loading screen before location is received', () => {
    mockLocation.requestForegroundPermissionsAsync.mockReturnValue(new Promise(() => {}));
    const { getByText } = render(<MapScreen />);
    expect(getByText('Locating...')).toBeTruthy();
  });

  // 2 ── Permission granted → map + location dot
  it('shows map with user location when permission granted', async () => {
    grantLocation();
    const { getByTestId } = render(<MapScreen />);
    await waitFor(() => expect(getByTestId('map-view').props.showsUserLocation).toBe(true));
  });

  // 3 ── Permission denied → map without location dot, no 📍 button
  it('shows map without 📍 button when permission denied', async () => {
    mockLocation.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' } as any);
    const { getByTestId, queryByText } = render(<MapScreen />);
    await waitFor(() => expect(getByTestId('map-view')).toBeTruthy());
    expect(getByTestId('map-view').props.showsUserLocation).toBe(false);
    expect(queryByText('📍')).toBeNull();
  });

  // 4 ── Tap map → marker appears
  it('tapping the map adds a marker at the correct coordinates', async () => {
    grantLocation();
    const { getByTestId } = render(<MapScreen />);
    await waitFor(() => getByTestId('map-view'));
    await act(async () => {
      tapMap(getByTestId('map-view'), 31.5, 34.8);
    });
    const marker = getByTestId('tap-marker');
    expect(marker.props.accessibilityLabel).toBe('31.5,34.8');
  });

  // 5 ── Tap map → bottom panel appears with Navigate Here button
  it('tapping the map shows a bottom panel with a navigate button', async () => {
    grantLocation();
    const { getByTestId, getByText } = render(<MapScreen />);
    await waitFor(() => getByTestId('map-view'));
    await act(async () => {
      tapMap(getByTestId('map-view'));
    });
    expect(getByText(/Navigate/i)).toBeTruthy();
  });

  // 6 ── Panel shows the address (falls back to coords if no reverse geocode result)
  it('the panel shows fallback coords when reverseGeocode returns nothing', async () => {
    grantLocation();
    (mockLocation.reverseGeocodeAsync as jest.Mock).mockResolvedValue([]);
    const { getByTestId, findByText } = render(<MapScreen />);
    await waitFor(() => getByTestId('map-view'));
    await act(async () => {
      tapMap(getByTestId('map-view'), 31.12345, 34.98765);
    });
    expect(await findByText('31.12345, 34.98765')).toBeTruthy();
  });

  // 7 ── Navigate button calls router.push with correct lat/lng
  it('navigate button calls router.push with correct lat and lng', async () => {
    grantLocation();
    const { router } = require('expo-router');
    const { getByTestId, getByText } = render(<MapScreen />);
    await waitFor(() => getByTestId('map-view'));
    await act(async () => {
      tapMap(getByTestId('map-view'), 31.5, 34.8);
    });
    fireEvent.press(getByText(/Navigate/i));
    expect(router.push).toHaveBeenCalledWith(expect.stringContaining('lat=31.5'));
    expect(router.push).toHaveBeenCalledWith(expect.stringContaining('lng=34.8'));
  });

  // 8 ── ✕ closes panel and removes the tap marker
  it('tapping ✕ closes the panel and removes the marker', async () => {
    grantLocation();
    const { getByTestId, getByText, queryByText, queryByTestId } = render(<MapScreen />);
    await waitFor(() => getByTestId('map-view'));
    await act(async () => {
      tapMap(getByTestId('map-view'));
    });
    expect(getByText(/Navigate/i)).toBeTruthy();
    fireEvent.press(getByText('✕'));
    expect(queryByText(/Navigate/i)).toBeNull();
    expect(queryByTestId('tap-marker')).toBeNull();
  });

  // 9 ── Second tap replaces first pin (only one tap-marker at a time)
  it('second tap replaces the existing pin — only one marker at a time', async () => {
    grantLocation();
    const { getByTestId, getAllByTestId } = render(<MapScreen />);
    await waitFor(() => getByTestId('map-view'));
    await act(async () => {
      tapMap(getByTestId('map-view'), 31.1, 34.1);
      tapMap(getByTestId('map-view'), 32.2, 35.2);
    });
    expect(getAllByTestId('tap-marker').length).toBe(1);
    expect(getByTestId('tap-marker').props.accessibilityLabel).toBe('32.2,35.2');
  });

  // 10 ── 📍 button calls animateToRegion with user location
  it('📍 button calls animateToRegion with user location', async () => {
    grantLocation(32.08, 34.78);
    const { getByText } = render(<MapScreen />);
    await waitFor(() => getByText('📍'));
    fireEvent.press(getByText('📍'));
    expect(mockAnimateToRegion).toHaveBeenCalledWith(
      { latitude: 32.08, longitude: 34.78, latitudeDelta: 0.01, longitudeDelta: 0.01 },
      500,
    );
  });
});

// ─── Search feature edge cases ────────────────────────────────────────────────

describe('Search feature', () => {

  // 11 ── Exact shelter name → panel opens with shelter info
  it('searching by exact shelter name opens the shelter panel', async () => {
    global.fetch = makeFetchWithShelters([SHELTER_A]);
    grantLocation();
    const { getByTestId, findByText } = render(<MapScreen />);
    await waitFor(() => getByTestId('map-view'));

    fireEvent.changeText(getByTestId('search-input'), 'מקלט גן העצמאות');
    await act(async () => { fireEvent.press(getByTestId('search-button')); });

    expect(await findByText('מקלט גן העצמאות')).toBeTruthy();
    expect(mockAnimateToRegion).toHaveBeenCalledWith(
      expect.objectContaining({ latitude: 31.25, longitude: 34.79 }),
      500,
    );
  });

  // 12 ── Partial match (substring) → still finds the shelter
  it('partial name match finds the shelter', async () => {
    global.fetch = makeFetchWithShelters([SHELTER_A]);
    grantLocation();
    const { getByTestId, findByText } = render(<MapScreen />);
    await waitFor(() => getByTestId('map-view'));

    fireEvent.changeText(getByTestId('search-input'), 'גן העצמאות');
    await act(async () => { fireEvent.press(getByTestId('search-button')); });

    expect(await findByText('מקלט גן העצמאות')).toBeTruthy();
  });

  // 13 ── Search by shelter address → finds the shelter (not Nominatim)
  it('searching by shelter address opens the shelter panel without calling Nominatim', async () => {
    global.fetch = makeFetchWithShelters([SHELTER_A]);
    grantLocation();
    const { getByTestId, findByText } = render(<MapScreen />);
    await waitFor(() => getByTestId('map-view'));

    fireEvent.changeText(getByTestId('search-input'), 'הרצל 1');
    await act(async () => { fireEvent.press(getByTestId('search-button')); });

    expect(await findByText('מקלט גן העצמאות')).toBeTruthy();
    // Only one fetch call (shelters load) — Nominatim was never called
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(1);
  });

  // 14 ── No shelter match → falls back to Nominatim and shows address pin
  it('when no shelter matches, falls back to Nominatim and shows a pin', async () => {
    global.fetch = makeFetchSequence(
      { shelters: [SHELTER_A], count: 1 },          // shelters load
      [{ lat: '32.0', lon: '34.9', display_name: 'תל אביב, ישראל' }], // Nominatim
    );
    grantLocation();
    const { getByTestId, findByText } = render(<MapScreen />);
    await waitFor(() => getByTestId('map-view'));

    fireEvent.changeText(getByTestId('search-input'), 'תל אביב'); // not a shelter name
    await act(async () => { fireEvent.press(getByTestId('search-button')); });

    expect(await findByText('תל אביב, ישראל')).toBeTruthy();
    expect(mockAnimateToRegion).toHaveBeenCalledWith(
      expect.objectContaining({ latitude: 32.0, longitude: 34.9 }),
      500,
    );
  });

  // 15 ── Empty / whitespace-only query → does nothing
  it('empty or whitespace search query does nothing', async () => {
    grantLocation();
    const { getByTestId } = render(<MapScreen />);
    await waitFor(() => getByTestId('map-view'));

    fireEvent.changeText(getByTestId('search-input'), '   ');
    await act(async () => { fireEvent.press(getByTestId('search-button')); });

    expect(mockAnimateToRegion).not.toHaveBeenCalled();
  });

  // 16 ── Nominatim returns empty array → no crash, no pin, no panel
  it('Nominatim returning no results does not crash or show a pin', async () => {
    global.fetch = makeFetchSequence(
      { shelters: [], count: 0 }, // shelters load
      [],                         // Nominatim returns nothing
    );
    grantLocation();
    const { getByTestId, queryByText } = render(<MapScreen />);
    await waitFor(() => getByTestId('map-view'));

    fireEvent.changeText(getByTestId('search-input'), 'כתובת לא קיימת');
    await act(async () => { fireEvent.press(getByTestId('search-button')); });

    expect(mockAnimateToRegion).not.toHaveBeenCalled();
    expect(queryByText(/Navigate/i)).toBeNull();
    expect(getByTestId('map-view')).toBeTruthy(); // map still visible
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
    await waitFor(() => getByTestId('map-view'));

    fireEvent.changeText(getByTestId('search-input'), 'כתובת לא קיימת');
    await act(async () => { fireEvent.press(getByTestId('search-button')); });

    expect(getByTestId('map-view')).toBeTruthy(); // map still there, no throw
  });

  // 18 ── Pressing Enter triggers search (same as tapping the button)
  it('pressing Enter on the search input triggers the search', async () => {
    global.fetch = makeFetchWithShelters([SHELTER_A]);
    grantLocation();
    const { getByTestId, findByText } = render(<MapScreen />);
    await waitFor(() => getByTestId('map-view'));

    fireEvent.changeText(getByTestId('search-input'), 'גן העצמאות');
    await act(async () => { fireEvent(getByTestId('search-input'), 'submitEditing'); });

    expect(await findByText('מקלט גן העצמאות')).toBeTruthy();
  });

  // 19 ── ✕ button clears the search input and the pin
  it('✕ button clears the search input and removes the address pin', async () => {
    global.fetch = makeFetchSequence(
      { shelters: [], count: 0 },
      [{ lat: '32.0', lon: '34.9', display_name: 'תל אביב, ישראל' }],
    );
    grantLocation();
    const { getByTestId, findByText, queryByTestId } = render(<MapScreen />);
    await waitFor(() => getByTestId('map-view'));

    // Search for an address so Nominatim places a pin
    fireEvent.changeText(getByTestId('search-input'), 'תל אביב');
    await act(async () => { fireEvent.press(getByTestId('search-button')); });
    expect(await findByText('תל אביב, ישראל')).toBeTruthy();

    // Press ✕ in the search bar — should clear everything
    fireEvent.press(getByTestId('search-clear'));
    expect(getByTestId('search-input').props.value).toBe('');
    expect(queryByTestId('tap-marker')).toBeNull();
  });

  // 20 ── Multiple shelters: picks the first match
  it('with multiple shelters, the first name match is selected', async () => {
    const shelterB = { lat: 31.3, lng: 34.8, name: 'מקלט גן לאומי', address: 'רחוב 2' };
    global.fetch = makeFetchWithShelters([SHELTER_A, shelterB]);
    grantLocation();
    const { getByTestId, findByText } = render(<MapScreen />);
    await waitFor(() => getByTestId('map-view'));

    fireEvent.changeText(getByTestId('search-input'), 'מקלט גן העצמאות');
    await act(async () => { fireEvent.press(getByTestId('search-button')); });

    // Should open panel for SHELTER_A specifically, not shelterB
    expect(await findByText('מקלט גן העצמאות')).toBeTruthy();
    expect(mockAnimateToRegion).toHaveBeenCalledWith(
      expect.objectContaining({ latitude: 31.25, longitude: 34.79 }),
      500,
    );
  });
});
