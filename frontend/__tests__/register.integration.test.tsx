/**
 * Integration tests for the Register screen.
 *
 * Renders the real <RegisterScreen /> and only stubs the network
 * (`global.fetch`) and `expo-router`. All validation, button state, error
 * rendering, and navigation logic runs the real code path.
 */
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    replace: jest.fn(),
  },
}));

import RegisterScreen from '../app/register';

function fillForm(api: ReturnType<typeof render>) {
  const { getByPlaceholderText } = api;
  fireEvent.changeText(getByPlaceholderText('First Name'), 'John');
  fireEvent.changeText(getByPlaceholderText('Last Name'), 'Doe');
  fireEvent.changeText(getByPlaceholderText('Email'), 'john@example.com');
  fireEvent.changeText(getByPlaceholderText('Password'), 'pw123');
  fireEvent.changeText(getByPlaceholderText('Telephone'), '0501234567');
  fireEvent.changeText(getByPlaceholderText('Address'), '123 Main St');
}

beforeEach(() => {
  mockPush.mockClear();
  (global.fetch as jest.Mock) = jest.fn();
});

describe('RegisterScreen integration', () => {
  it('blocks submission and shows an error when fields are missing', async () => {
    const api = render(<RegisterScreen />);

    fireEvent.press(api.getByText('Create Account'));

    expect(await api.findByText('Please fill in all fields')).toBeTruthy();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('posts the full payload to /auth/register and navigates to login on success', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ message: 'User registered successfully' }),
    });

    const api = render(<RegisterScreen />);
    fillForm(api);
    fireEvent.press(api.getByText('Create Account'));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toMatch(/\/auth\/register$/);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      firstName: 'John',
      lastName: 'Doe',
      email: 'john@example.com',
      password: 'pw123',
      telephone: '0501234567',
      address: '123 Main St',
    });

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/login'));
  });

  it('shows the server error message when registration fails', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      json: async () => ({ detail: 'User already exists' }),
    });

    const api = render(<RegisterScreen />);
    fillForm(api);
    fireEvent.press(api.getByText('Create Account'));

    expect(await api.findByText('User already exists')).toBeTruthy();
    expect(mockPush).not.toHaveBeenCalledWith('/login');
  });

  it('shows a connection error when the backend is unreachable', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('network'));

    const api = render(<RegisterScreen />);
    fillForm(api);
    fireEvent.press(api.getByText('Create Account'));

    expect(await api.findByText('Cannot connect to server')).toBeTruthy();
  });

  it('navigates to the login screen when the link is pressed', () => {
    const api = render(<RegisterScreen />);

    fireEvent.press(api.getByText('Sign In'));

    expect(mockPush).toHaveBeenCalledWith('/login');
  });
});
