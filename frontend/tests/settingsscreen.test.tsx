import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import SettingsScreen from '../app/(tabs)/settings';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
}));

jest.spyOn(Alert, 'alert');

global.fetch = jest.fn(() => 
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ status: 'success' }),
  } as Response)
) as jest.Mock;

describe('SettingsScreen Component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // TEST 1: Rendering and User Interaction
  it('renders correctly and allows user to update the address', () => {
    const { getByText, getByPlaceholderText } = render(<SettingsScreen />);

    // Check if the main header rendered
    expect(getByText('Emergency Settings')).toBeTruthy();

    // Find the address input and simulate typing
    const addressInput = getByPlaceholderText('Enter your full address');
    fireEvent.changeText(addressInput, '123 Safe St, Be\'er Sheva');

    // The component should hold the new value in its state (implicitly tested if no errors)
    expect(addressInput.props.value).toBe('123 Safe St, Be\'er Sheva');
  });

  // TEST 2: Triggering the Save Function
  it('saves settings to AsyncStorage and shows a success alert when Save is pressed', async () => {
    const { getByText, getByPlaceholderText } = render(<SettingsScreen />);

    // 1. Simulate filling out the form
    const addressInput = getByPlaceholderText('Enter your full address');
    const radiusInput = getByPlaceholderText('e.g., 500');
    
    fireEvent.changeText(addressInput, '456 Test Ave');
    fireEvent.changeText(radiusInput, '1000');
    
    // Select 'Driving' mode
    const drivingButton = getByText('Driving');
    fireEvent.press(drivingButton);

    // 2. Press the save button
    const saveButton = getByText('Save Preferences');
    fireEvent.press(saveButton);

    // 3. Verify the correct actions happened asynchronously
    await waitFor(() => {
      // Check if AsyncStorage.setItem was called with the right data key and stringified JSON
      expect(AsyncStorage.setItem).toHaveBeenCalledWith(
        'userSettings',
        JSON.stringify({
          address: '456 Test Ave',
          radius: '1000',
          transportMode: 'driving',
          isHandicapped: false // default state
        })
      );

      // Check if the backend fetch was triggered
      expect(global.fetch).toHaveBeenCalledTimes(1);

      // Check if the success alert was shown to the user
      expect(Alert.alert).toHaveBeenCalledWith("Success", "Settings saved successfully.");
    });
  });
});