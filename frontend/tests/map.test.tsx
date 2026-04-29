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
const mockRouterPush = jest.fn();

jest.mock('expo-router', () => ({
  router: { push: (...args: any[]) => mockRouterPush(...args) },
}));

jest.mock('react-native-maps', () => {
  const React = require('react');
  const { View, TouchableOpacity } = require('react-native');

  const MockMapView = React.forwardRef((props: any, ref: any) => {
    React.useImperativeHandle(ref, () => ({ animateToRegion: mockAnimateToRegion }));
    return <View testID="map-view" {...props} />;
  });

  const MockMarker = ({ children, onPress }: any) => (
    <TouchableOpacity
      testID="shelter-marker"
      onPress={() => onPress?.({ stopPropagation: () => {} })}
    >
      {children}
    </TouchableOpacity>
  );

  return {
    __esModule: true,
    default: MockMapView,
    Marker: MockMarker,
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

function setupShelterWithCoords() {
  global.fetch = jest.fn().mockResolvedValue({
    json: async () => ({ shelters: [mockShelter] }),
  }) as any;
  mockLocation.geocodeAsync = jest.fn().mockResolvedValue([
    { latitude: 31.25, longitude: 34.79 },
  ]);
}

// ─── טסטים בסיסיים ───────────────────────────────────────────────────────────

describe('MapScreen — בסיסי', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAnimateToRegion.mockClear();
    mockRouterPush.mockClear();
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
    mockRouterPush.mockClear();
    mockLocation.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' } as any);
  });

  it('מציג סמן מקלט על המפה לאחר גיאוקודינג', async () => {
    setupShelterWithCoords();
    const { findAllByTestId } = render(<MapScreen />);
    const markers = await findAllByTestId('shelter-marker');
    expect(markers.length).toBe(1);
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

  it('לחיצה על סמן מקלט מציגה פאנל מידע', async () => {
    setupShelterWithCoords();
    const { findByTestId, findByText } = render(<MapScreen />);
    const marker = await findByTestId('shelter-marker');
    fireEvent.press(marker);
    expect(await findByTestId('shelter-panel')).toBeTruthy();
    expect(await findByText('מקלט בן גוריון')).toBeTruthy();
    expect(await findByText('בן גוריון 33')).toBeTruthy();
  });

  it('לחיצה על כפתור נווט קוראת לrouter.push עם הנתיב הנכון', async () => {
    setupShelterWithCoords();
    const { findByTestId, findByText } = render(<MapScreen />);
    fireEvent.press(await findByTestId('shelter-marker'));
    fireEvent.press(await findByText('🧭 נווט למקלט'));
    expect(mockRouterPush).toHaveBeenCalledWith(
      expect.stringContaining('/navigate?lat=31.25&lng=34.79')
    );
  });

  it('לחיצה על X סוגרת את הפאנל', async () => {
    setupShelterWithCoords();
    const { findByTestId, findByText, queryByTestId } = render(<MapScreen />);
    fireEvent.press(await findByTestId('shelter-marker'));
    await findByTestId('shelter-panel');
    fireEvent.press(await findByText('✕'));
    await waitFor(() => expect(queryByTestId('shelter-panel')).toBeNull());
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
