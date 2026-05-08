import React from 'react';
import { render, waitFor, fireEvent } from '@testing-library/react-native';
import * as Location from 'expo-location';
import MapScreen from '../app/(tabs)/map';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
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

  const MockMarker = ({ coordinate }: any) => (
    <View
      testID="map-marker"
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

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('MapScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAnimateToRegion.mockClear();
  });

  // 1 ── Loading
  it('מציג מסך טעינה לפני קבלת מיקום', () => {
    mockLocation.requestForegroundPermissionsAsync.mockReturnValue(new Promise(() => {}));
    const { getByText } = render(<MapScreen />);
    expect(getByText('מאתר מיקום...')).toBeTruthy();
  });

  // 2 ── Permission granted → map + location dot
  it('מציג מפה עם מיקום משתמש כשהרשאה אושרה', async () => {
    grantLocation();
    const { getByTestId } = render(<MapScreen />);
    await waitFor(() => expect(getByTestId('map-view').props.showsUserLocation).toBe(true));
  });

  // 3 ── Permission denied → map without location dot, no 📍 button
  it('מציג מפה ללא כפתור 📍 כשהרשאה נדחתה', async () => {
    mockLocation.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' } as any);
    const { getByTestId, queryByText } = render(<MapScreen />);
    await waitFor(() => expect(getByTestId('map-view')).toBeTruthy());
    expect(getByTestId('map-view').props.showsUserLocation).toBe(false);
    expect(queryByText('📍')).toBeNull();
  });

  // 4 ── Tap map → marker appears
  it('לחיצה על המפה מוסיפה Marker בקואורדינטות הנכונות', async () => {
    grantLocation();
    const { getByTestId } = render(<MapScreen />);
    await waitFor(() => getByTestId('map-view'));
    tapMap(getByTestId('map-view'), 31.5, 34.8);
    const marker = getByTestId('map-marker');
    expect(marker.props.accessibilityLabel).toBe('31.5,34.8');
  });

  // 5 ── Tap map → bottom panel appears
  it('לחיצה על המפה מציגה פאנל תחתון עם כפתור ניווט', async () => {
    grantLocation();
    const { getByTestId, getByText } = render(<MapScreen />);
    await waitFor(() => getByTestId('map-view'));
    tapMap(getByTestId('map-view'));
    expect(getByText('🧭  נווט לכאן')).toBeTruthy();
  });

  // 6 ── Panel shows formatted coordinates
  it('הפאנל מציג את הקואורדינטות בפורמט הנכון', async () => {
    grantLocation();
    const { getByTestId, getByText } = render(<MapScreen />);
    await waitFor(() => getByTestId('map-view'));
    tapMap(getByTestId('map-view'), 31.12345, 34.98765);
    expect(getByText('31.12345, 34.98765')).toBeTruthy();
  });

  // 7 ── Navigate button calls router.push with correct lat/lng
  it('כפתור נווט קורא לrouter.push עם lat ו-lng נכונים', async () => {
    grantLocation();
    const { router } = require('expo-router');
    const { getByTestId, getByText } = render(<MapScreen />);
    await waitFor(() => getByTestId('map-view'));
    tapMap(getByTestId('map-view'), 31.5, 34.8);
    fireEvent.press(getByText('🧭  נווט לכאן'));
    expect(router.push).toHaveBeenCalledWith(
      expect.stringContaining('lat=31.5')
    );
    expect(router.push).toHaveBeenCalledWith(
      expect.stringContaining('lng=34.8')
    );
  });

  // 8 ── ✕ closes panel and removes marker
  it('לחיצה על ✕ סוגרת את הפאנל ומסירה את הסמן', async () => {
    grantLocation();
    const { getByTestId, getByText, queryByText, queryByTestId } = render(<MapScreen />);
    await waitFor(() => getByTestId('map-view'));
    tapMap(getByTestId('map-view'));
    expect(getByText('🧭  נווט לכאן')).toBeTruthy();
    fireEvent.press(getByText('✕'));
    expect(queryByText('🧭  נווט לכאן')).toBeNull();
    expect(queryByTestId('map-marker')).toBeNull();
  });

  // 9 ── Second tap replaces first pin (only one marker at a time)
  it('לחיצה שנייה מחליפה את הPin הקיים — רק marker אחד בכל עת', async () => {
    grantLocation();
    const { getByTestId, getAllByTestId } = render(<MapScreen />);
    await waitFor(() => getByTestId('map-view'));
    tapMap(getByTestId('map-view'), 31.1, 34.1);
    tapMap(getByTestId('map-view'), 32.2, 35.2);
    expect(getAllByTestId('map-marker').length).toBe(1);
    expect(getByTestId('map-marker').props.accessibilityLabel).toBe('32.2,35.2');
  });

  // 10 ── 📍 button calls animateToRegion with user location
  it('כפתור 📍 קורא לanimateToRegion עם מיקום המשתמש', async () => {
    grantLocation(32.08, 34.78);
    const { getByText } = render(<MapScreen />);
    await waitFor(() => getByText('📍'));
    fireEvent.press(getByText('📍'));
    expect(mockAnimateToRegion).toHaveBeenCalledWith(
      { latitude: 32.08, longitude: 34.78, latitudeDelta: 0.01, longitudeDelta: 0.01 },
      500
    );
  });
});
