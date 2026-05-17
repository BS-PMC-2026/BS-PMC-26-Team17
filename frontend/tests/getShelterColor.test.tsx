import { getShelterColor } from '../app/(tabs)/map';

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

jest.mock('react-native-webview', () => {
  const React = require('react');
  const { View } = require('react-native');
  const MockWebView = React.forwardRef((props: any, ref: any) => {
    React.useImperativeHandle(ref, () => ({ postMessage: jest.fn() }));
    return React.createElement(View, props);
  });
  return { WebView: MockWebView };
});

const shelter = (overrides: Record<string, unknown> = {}) =>
  ({
    id: 'test',
    latitude: 31.5,
    longitude: 34.8,
    name: 'Test',
    address: 'Test Address',
    ...overrides,
  } as any);

describe('getShelterColor', () => {
  it('returns red for accessStatus "closed"', () => {
    expect(getShelterColor(shelter({ accessStatus: 'closed' }))).toBe('#E24B4A');
  });

  it('returns red for accessStatus "locked"', () => {
    expect(getShelterColor(shelter({ accessStatus: 'locked' }))).toBe('#E24B4A');
  });

  it('returns red when shouldBeOpen is false', () => {
    expect(getShelterColor(shelter({ accessStatus: 'open', shouldBeOpen: false }))).toBe('#E24B4A');
  });

  it('returns yellow when isFull is true', () => {
    expect(getShelterColor(shelter({ accessStatus: 'open', isFull: true }))).toBe('#F5A623');
  });

  it('returns green for accessStatus "open"', () => {
    expect(getShelterColor(shelter({ accessStatus: 'open' }))).toBe('#1D9E75');
  });

  it('returns green for accessStatus "unknown"', () => {
    expect(getShelterColor(shelter({ accessStatus: 'unknown' }))).toBe('#1D9E75');
  });

  it('returns green when shouldBeOpen is true', () => {
    expect(getShelterColor(shelter({ shouldBeOpen: true }))).toBe('#1D9E75');
  });
});
