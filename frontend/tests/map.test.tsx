import React from 'react';
import { render, waitFor, fireEvent } from '@testing-library/react-native';
import * as Location from 'expo-location';
import MapScreen from '../app/(tabs)/map';

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
}));

const mockAnimateToRegion = jest.fn();

jest.mock('react-native-maps', () => {
  const React = require('react');
  const { View } = require('react-native');
  const MockMapView = React.forwardRef((props: any, ref: any) => {
    React.useImperativeHandle(ref, () => ({ animateToRegion: mockAnimateToRegion }));
    return <View testID="map-view" {...props} />;
  });
  return { __esModule: true, default: MockMapView, PROVIDER_DEFAULT: null };
});

const mockLocation = Location as jest.Mocked<typeof Location>;

describe('MapScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAnimateToRegion.mockClear();
  });

  it('מציג מסך טעינה בהתחלה', () => {
    mockLocation.requestForegroundPermissionsAsync.mockReturnValue(new Promise(() => {}));
    const { getByText } = render(<MapScreen />);
    expect(getByText('מאתר מיקום...')).toBeTruthy();
  });

  it('מציג מפה ללא מיקום כשהרשאה נדחתה', async () => {
    mockLocation.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' } as any);
    const { getByTestId } = render(<MapScreen />);
    await waitFor(() => expect(getByTestId('map-view')).toBeTruthy());
    expect(getByTestId('map-view').props.showsUserLocation).toBe(false);
  });

  it('מציג מפה עם מיקום משתמש כשהרשאה אושרה', async () => {
    mockLocation.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' } as any);
    mockLocation.getCurrentPositionAsync.mockResolvedValue({
      coords: { latitude: 32.08, longitude: 34.78 },
    } as any);
    const { getByTestId } = render(<MapScreen />);
    await waitFor(() => expect(getByTestId('map-view')).toBeTruthy());
    expect(getByTestId('map-view').props.showsUserLocation).toBe(true);
  });

  it('כפתור המיקוד לא מוצג כשהרשאה נדחתה', async () => {
    mockLocation.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' } as any);
    const { queryByText } = render(<MapScreen />);
    await waitFor(() => expect(queryByText('📍')).toBeNull());
  });

  it('לחיצה על כפתור המיקוד קוראת animateToRegion עם הקואורדינטות הנכונות', async () => {
    mockLocation.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' } as any);
    mockLocation.getCurrentPositionAsync.mockResolvedValue({
      coords: { latitude: 32.08, longitude: 34.78 },
    } as any);
    const { getByText } = render(<MapScreen />);
    await waitFor(() => expect(getByText('📍')).toBeTruthy());
    fireEvent.press(getByText('📍'));
    expect(mockAnimateToRegion).toHaveBeenCalledWith(
      { latitude: 32.08, longitude: 34.78, latitudeDelta: 0.01, longitudeDelta: 0.01 },
      500
    );
  });
});
