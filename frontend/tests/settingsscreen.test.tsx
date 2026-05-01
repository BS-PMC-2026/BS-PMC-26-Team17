import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import SettingsScreen from '../app/(tabs)/settings';
import { AuthProvider } from '../context/auth';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
}));

jest.spyOn(Alert, 'alert');

global.fetch = jest.fn(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ status: 'success' }),
  } as Response)
) as jest.Mock;

const renderWithAuth = (component: React.ReactElement) =>
  render(<AuthProvider>{component}</AuthProvider>);

describe('SettingsScreen Component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // TEST 1: Rendering and User Interaction
  it('renders correctly and allows user to update the address', async () => {
    const { getByText, getByPlaceholderText } = renderWithAuth(<SettingsScreen />);

    // Check if the main header rendered
    expect(getByText('Emergency Settings')).toBeTruthy();

    // Press Edit to reveal the address input
    const editButton = getByText('Edit');
    fireEvent.press(editButton);

    // Find the address input and simulate typing
    const addressInput = getByPlaceholderText('Enter your full address');
    fireEvent.changeText(addressInput, "123 Safe St, Be'er Sheva");

    // The component should hold the new value in its state
    expect(addressInput.props.value).toBe("123 Safe St, Be'er Sheva");
  });

  // TEST 2: Triggering the Save Function
  it('saves settings to AsyncStorage and shows a success alert when Save Preferences is pressed', async () => {
    const { getByText, getAllByText } = renderWithAuth(<SettingsScreen />);

    // Press 'Driving' transport mode
    const drivingButton = getByText('Driving');
    fireEvent.press(drivingButton);

    // Press the main Save Preferences button
    const saveButton = getByText('Save Preferences');
    fireEvent.press(saveButton);

    // Verify the correct actions happened asynchronously
    await waitFor(() => {
      // Check if AsyncStorage.setItem was called
      expect(AsyncStorage.setItem).toHaveBeenCalledWith(
        'userSettings',
        expect.any(String)
      );

      // Check if the success alert was shown to the user
      expect(Alert.alert).toHaveBeenCalledWith('Success', 'Settings saved successfully.');
    });
  });

  // TEST 3: Radius validation - negative value
  it('shows error when radius is negative', async () => {
    const { getAllByText, getByPlaceholderText } = renderWithAuth(<SettingsScreen />);

    // Press the second Edit button (radius)
    const editButtons = getAllByText('Edit');
    fireEvent.press(editButtons[1]);

    const radiusInput = getByPlaceholderText('e.g., 500');
    fireEvent.changeText(radiusInput, '-10');

    const saveButtons = getAllByText('Save');
    fireEvent.press(saveButtons[0]);

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith('Invalid', 'Radius cannot be negative.');
    });
  });

  // TEST 4: Radius validation - value too large
  it('shows error when radius exceeds 1500', async () => {
    const { getAllByText, getByPlaceholderText } = renderWithAuth(<SettingsScreen />);

    // Press the second Edit button (radius)
    const editButtons = getAllByText('Edit');
    fireEvent.press(editButtons[1]);

    const radiusInput = getByPlaceholderText('e.g., 500');
    fireEvent.changeText(radiusInput, '2000');

    const saveButtons = getAllByText('Save');
    fireEvent.press(saveButtons[0]);

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith('Invalid', 'Radius cannot be more than 1500 meters.');
    });
  });
});
