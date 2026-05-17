import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import SettingsScreen from '../app/(tabs)/settings';
import { AuthProvider } from '../context/auth';

// SettingsScreen now imports `router` from expo-router (Back button +
// admin Shelter Dashboard shortcut). Stub the module so jest doesn't pull
// in the real navigator under the hood.
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
}));

// SettingsScreen uses useFocusEffect to refresh on focus. In a unit-test
// environment there's no navigator, so we mock it to behave like useEffect
// and just invoke the callback once on mount.
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('@react-navigation/native', () => {
  const React = require('react');
  return {
    useFocusEffect: (cb: () => void | (() => void)) => {
      React.useEffect(() => {
        const cleanup = cb();
        return typeof cleanup === 'function' ? cleanup : undefined;
      }, []);
    },
  };
});

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
}));

jest.spyOn(Alert, 'alert');

// Address autocomplete hits Nominatim — return something benign so the
// debounced fetch doesn't blow up in tests.
global.fetch = jest.fn(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve([]),
  } as Response),
) as jest.Mock;

const renderWithAuth = (component: React.ReactElement) =>
  render(<AuthProvider>{component}</AuthProvider>);

describe('SettingsScreen Component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // TEST 1: Rendering and address input — the autocompleting field accepts
  // free text and reflects the typed value back in its `value` prop.
  it('renders correctly and lets the user type into the address field', async () => {
    const { getByText, getByPlaceholderText } = renderWithAuth(<SettingsScreen />);

    // Main header
    expect(getByText('Emergency Settings')).toBeTruthy();

    // The address input now uses an autocomplete placeholder; no Edit button.
    const addressInput = getByPlaceholderText('e.g., Herzl, Tel Aviv');
    fireEvent.changeText(addressInput, "123 Safe St, Be'er Sheva");

    // The TextInput is controlled — its value should reflect what we typed
    expect(addressInput.props.value).toBe("123 Safe St, Be'er Sheva");
  });

  // TEST 2: Save Preferences (the only save button now) writes to AsyncStorage
  // and surfaces a success alert. No address typed → bypasses the
  // "address not picked" confirmation path.
  it('saves settings to AsyncStorage and shows a success alert when Save Preferences is pressed', async () => {
    const { getByText } = renderWithAuth(<SettingsScreen />);

    // Change a non-address field so we exercise some state mutation
    fireEvent.press(getByText('Driving'));

    fireEvent.press(getByText('Save Preferences'));

    await waitFor(() => {
      expect(AsyncStorage.setItem).toHaveBeenCalledWith(
        'userSettings',
        expect.any(String),
      );
      expect(Alert.alert).toHaveBeenCalledWith(
        'Saved',
        'Your preferences have been saved.',
      );
    });
  });

  // TEST 3: Negative radius triggers validation BEFORE save runs.
  // Alert title is "Invalid radius" (matches settings.tsx).
  it('shows error when radius is negative', async () => {
    const { getByText, getByPlaceholderText } = renderWithAuth(<SettingsScreen />);

    const radiusInput = getByPlaceholderText('e.g., 500');
    fireEvent.changeText(radiusInput, '-10');

    fireEvent.press(getByText('Save Preferences'));

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith(
        'Invalid radius',
        'Radius cannot be negative.',
      );
    });
  });

  // TEST 4: Radius over 1500 also fails validation.
  it('shows error when radius exceeds 1500', async () => {
    const { getByText, getByPlaceholderText } = renderWithAuth(<SettingsScreen />);

    const radiusInput = getByPlaceholderText('e.g., 500');
    fireEvent.changeText(radiusInput, '2000');

    fireEvent.press(getByText('Save Preferences'));

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith(
        'Invalid radius',
        'Radius cannot be more than 1500 meters.',
      );
    });
  });
});
