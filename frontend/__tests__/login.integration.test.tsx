/**
 * Integration tests for the Login screen.
 *
 * These tests render the real <LoginScreen /> component (including the auth
 * context wrapping) and stub only the network boundary (`global.fetch`) and
 * `expo-router`. Everything else - validation, button state, error display,
 * navigation calls - runs the real code path.
 */
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

const mockReplace = jest.fn();
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: {
    replace: (...args: unknown[]) => mockReplace(...args),
    push: (...args: unknown[]) => mockPush(...args),
  },
}));

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

import LoginScreen from '../app/login';
import { AuthProvider } from '../context/auth';

function renderLogin() {
  return render(
    <AuthProvider>
      <LoginScreen />
    </AuthProvider>,
  );
}

beforeEach(() => {
  mockReplace.mockClear();
  mockPush.mockClear();
  (global.fetch as jest.Mock) = jest.fn();
});

describe('LoginScreen integration', () => {
  it('shows a validation error when fields are empty', async () => {
    const { getByText, findByText } = renderLogin();

    fireEvent.press(getByText('Sign In'));

    expect(await findByText('Please fill in all fields')).toBeTruthy();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('calls /auth/login and navigates to tabs on success', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        message: 'Login successful',
        user: {
          id: '1',
          email: 'a@b.com',
          name: 'Alice B',
          role: 'user',
          telephone: '050',
        },
      }),
    });

    const { getByPlaceholderText, getByText } = renderLogin();

    fireEvent.changeText(getByPlaceholderText('Email'), 'a@b.com');
    fireEvent.changeText(getByPlaceholderText('Password'), 'pw');
    fireEvent.press(getByText('Sign In'));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toMatch(/\/auth\/login$/);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ email: 'a@b.com', password: 'pw' });

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(tabs)'));
  });

  it('shows the server error message when backend returns 401', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      json: async () => ({ detail: 'Invalid email or password' }),
    });

    const { getByPlaceholderText, getByText, findByText } = renderLogin();

    fireEvent.changeText(getByPlaceholderText('Email'), 'a@b.com');
    fireEvent.changeText(getByPlaceholderText('Password'), 'wrong');
    fireEvent.press(getByText('Sign In'));

    expect(await findByText('Invalid email or password')).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('shows a connection error when fetch throws', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('network down'));

    const { getByPlaceholderText, getByText, findByText } = renderLogin();

    fireEvent.changeText(getByPlaceholderText('Email'), 'a@b.com');
    fireEvent.changeText(getByPlaceholderText('Password'), 'pw');
    fireEvent.press(getByText('Sign In'));

    expect(await findByText('Cannot connect to server')).toBeTruthy();
  });

  it('navigates to the register screen when the link is pressed', () => {
    const { getByText } = renderLogin();

    fireEvent.press(getByText('Create an account'));

    expect(mockPush).toHaveBeenCalledWith('/register');
  });
});
