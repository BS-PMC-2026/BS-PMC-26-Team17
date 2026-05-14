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
    PROVIDER_DEFAULT: null,
  };
});

// Silence console.error from the (intentional) "Failed to load shelters" path
beforeAll(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const mockLocation = Location as jest.Mocked<typeof Location>;

const grantLocation = (lat = 32.08, lng = 34.78) => {
  mockLocation.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' } as any);
  mockLocation.getCurrentPositionAsync.mockResolvedValue({
    coords: { latitude: lat, longitude: lng },
  } as any);
};

const tapMap = (element: any, lat = 31.5, lng = 34.8) =>
  fireEvent.press(element, { nativeEvent: { coordinate: { latitude: lat, longitude: lng } } });

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
    expect(getByText(/Navigate Here/i)).toBeTruthy();
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
    fireEvent.press(getByText(/Navigate Here/i));
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
    expect(getByText(/Navigate Here/i)).toBeTruthy();
    fireEvent.press(getByText('✕'));
    expect(queryByText(/Navigate Here/i)).toBeNull();
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
