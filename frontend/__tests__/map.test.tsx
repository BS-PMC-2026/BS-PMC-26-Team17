import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';
import MapScreen from '../app/(tabs)/map';

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
}));

jest.mock('react-native-maps', () => {
  const { View } = require('react-native');
  const MockMapView = (props: any) => <View testID="map-view" {...props} />;
  return { __esModule: true, default: MockMapView, PROVIDER_DEFAULT: null };
});

const mockLocation = Location as jest.Mocked<typeof Location>;

describe('MapScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
});
