import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { fireEvent } from '@testing-library/react-native';
import * as Location from 'expo-location';
import MapScreen, { calcDistance, markerBg } from '../app/(tabs)/map';

// ─── Mocks ───────────────────────────────────────────────────────────────────

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  geocodeAsync: jest.fn(),
  Accuracy: { High: 4 },
}));

const mockAnimateToRegion = jest.fn();

jest.mock('react-native-maps', () => {
  const React = require('react');
  const { View } = require('react-native');

  const MockMapView = React.forwardRef((props: any, ref: any) => {
    React.useImperativeHandle(ref, () => ({ animateToRegion: mockAnimateToRegion }));
    return <View testID="map-view" {...props} />;
  });

  const MockMarker = ({ children }: any) => (
    <View testID="shelter-marker">{children}</View>
  );

  const MockCallout = ({ children }: any) => (
    <View testID="shelter-callout">{children}</View>
  );

  return {
    __esModule: true,
    default: MockMapView,
    Marker: MockMarker,
    Callout: MockCallout,
    PROVIDER_DEFAULT: null,
  };
});

const mockLocation = Location as jest.Mocked<typeof Location>;

const mockShelter = {
  name: 'מקלט בן גוריון',
  address: 'בן גוריון 33',
  city: "Be'er Sheva",
  accessStatus: 'open',
  isAccessible: true,
  hasStairs: false,
  isFull: false,
  capacity: 50,
  shouldBeOpen: true,
};

function setupGrantedLocation() {
  mockLocation.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' } as any);
  mockLocation.getCurrentPositionAsync.mockResolvedValue({
    coords: { latitude: 31.25, longitude: 34.79 },
  } as any);
}

// ─── טסטים בסיסיים ───────────────────────────────────────────────────────────

describe('MapScreen — בסיסי', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAnimateToRegion.mockClear();
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({ shelters: [] }),
    }) as any;
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
    setupGrantedLocation();
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
    setupGrantedLocation();
    const { getByText } = render(<MapScreen />);
    await waitFor(() => expect(getByText('📍')).toBeTruthy());
    fireEvent.press(getByText('📍'));
    expect(mockAnimateToRegion).toHaveBeenCalledWith(
      { latitude: 31.25, longitude: 34.79, latitudeDelta: 0.01, longitudeDelta: 0.01 },
      500
    );
  });
});

// ─── טסטים פיצר מקלטים ───────────────────────────────────────────────────────

describe('MapScreen — הצגת מקלטים', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAnimateToRegion.mockClear();
    mockLocation.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' } as any);
  });

  it('מציג סמן מקלט על המפה לאחר גיאוקודינג', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({ shelters: [mockShelter] }),
    }) as any;
    mockLocation.geocodeAsync = jest.fn().mockResolvedValue([
      { latitude: 31.25, longitude: 34.79 },
    ]);

    const { findAllByTestId } = render(<MapScreen />);
    const markers = await findAllByTestId('shelter-marker');
    expect(markers.length).toBe(1);
  });

  it('מציג שם מקלט ב-Callout', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({ shelters: [mockShelter] }),
    }) as any;
    mockLocation.geocodeAsync = jest.fn().mockResolvedValue([
      { latitude: 31.25, longitude: 34.79 },
    ]);

    const { findByText } = render(<MapScreen />);
    expect(await findByText('מקלט בן גוריון')).toBeTruthy();
  });

  it('מציג כתובת מקלט ב-Callout', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({ shelters: [mockShelter] }),
    }) as any;
    mockLocation.geocodeAsync = jest.fn().mockResolvedValue([
      { latitude: 31.25, longitude: 34.79 },
    ]);

    const { findByText } = render(<MapScreen />);
    expect(await findByText('בן גוריון 33')).toBeTruthy();
  });

  it('לא קורס כשה-API לא זמין', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Network error')) as any;
    const { getByTestId } = render(<MapScreen />);
    await waitFor(() => expect(getByTestId('map-view')).toBeTruthy());
  });

  it('לא מציג סמנים כשגיאוקודינג נכשל', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({ shelters: [mockShelter] }),
    }) as any;
    mockLocation.geocodeAsync = jest.fn().mockResolvedValue([]);

    const { queryAllByTestId } = render(<MapScreen />);
    await waitFor(() => {});
    expect(queryAllByTestId('shelter-marker').length).toBe(0);
  });
});

// ─── טסטים calcDistance ──────────────────────────────────────────────────────

describe('calcDistance', () => {
  const from = { latitude: 31.2500, longitude: 34.7900 };

  it('מחזיר מ׳ למרחק קצר', () => {
    const to = { lat: 31.2510, lng: 34.7900 }; // ~111 מטר
    expect(calcDistance(from, to)).toContain('מ׳');
  });

  it('מחזיר ק״מ למרחק ארוך', () => {
    const to = { lat: 32.0800, lng: 34.7800 }; // ~91 ק״מ
    expect(calcDistance(from, to)).toContain('ק״מ');
  });

  it('מחזיר מחרוזת ריקה כשאין מיקום משתמש', () => {
    expect(calcDistance(null, { lat: 31.25, lng: 34.79 })).toBe('');
  });
});

// ─── טסטים markerBg ──────────────────────────────────────────────────────────

describe('markerBg', () => {
  it('מחזיר ירוק לסטטוס open', () => {
    expect(markerBg('open')).toBe('#1D9E75');
  });

  it('מחזיר אדום לסטטוס closed', () => {
    expect(markerBg('closed')).toBe('#E24B4A');
  });

  it('מחזיר אדום לסטטוס locked', () => {
    expect(markerBg('locked')).toBe('#E24B4A');
  });

  it('מחזיר כתום לסטטוס unknown', () => {
    expect(markerBg('unknown')).toBe('#BA7517');
  });
});
