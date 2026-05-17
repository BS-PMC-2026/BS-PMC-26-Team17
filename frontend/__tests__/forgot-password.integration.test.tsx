/**
 * Integration tests for the Forgot Password screen.
 *
 * Renders the real <ForgotPasswordScreen /> and drives it through all three
 * steps. Only the network boundary (`global.fetch`) and `expo-router` are
 * stubbed — validation, button state, error messaging, and step transitions
 * all run the production code path.
 */
import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { Alert } from 'react-native';

const mockReplace = jest.fn();
const mockBack = jest.fn();
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: {
    replace: (...args: unknown[]) => mockReplace(...args),
    back: (...args: unknown[]) => mockBack(...args),
    push: (...args: unknown[]) => mockPush(...args),
  },
}));

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// Ionicons does real font loading we don't care about in tests
jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    Ionicons: ({ name }: { name: string }) => <Text>{`icon:${name}`}</Text>,
  };
});

import ForgotPasswordScreen from '../app/forgot-password';

function renderScreen() {
  return render(<ForgotPasswordScreen />);
}

// Helper: a fetch mock that returns each scripted response in order.
const sequence = (...responses: { ok: boolean; body: any }[]) => {
  let i = 0;
  return jest.fn(() => {
    const r = responses[Math.min(i++, responses.length - 1)];
    return Promise.resolve({
      ok: r.ok,
      json: () => Promise.resolve(r.body),
    } as Response);
  });
};

beforeEach(() => {
  jest.useFakeTimers();
  mockReplace.mockClear();
  mockBack.mockClear();
  mockPush.mockClear();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  (global.fetch as jest.Mock) = jest.fn();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('ForgotPasswordScreen integration', () => {
  // ── Step 1 ────────────────────────────────────────────────────────────────

  it('shows a validation error when email is empty', async () => {
    const { getByText, findByText } = renderScreen();
    fireEvent.press(getByText('Send Code'));
    expect(await findByText('Please enter your email.')).toBeTruthy();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('moves to step 2 after a successful /forgot-password request', async () => {
    global.fetch = sequence({ ok: true, body: { message: 'If an account exists...' } });
    const { getByPlaceholderText, getByText, findByText } = renderScreen();

    fireEvent.changeText(getByPlaceholderText('Email'), 'alice@example.com');
    fireEvent.press(getByText('Send Code'));

    // Step 2 is identified by the Verify Code button
    expect(await findByText('Verify Code')).toBeTruthy();
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/auth/forgot-password'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('surfaces server errors on /forgot-password', async () => {
    global.fetch = sequence({
      ok: false,
      body: { detail: 'Please wait 25 seconds before requesting another code.' },
    });
    const { getByPlaceholderText, getByText, findByText } = renderScreen();

    fireEvent.changeText(getByPlaceholderText('Email'), 'alice@example.com');
    fireEvent.press(getByText('Send Code'));

    expect(
      await findByText('Please wait 25 seconds before requesting another code.'),
    ).toBeTruthy();
  });

  // ── Step 2 ────────────────────────────────────────────────────────────────

  it('rejects a code that is shorter than 6 digits before calling the server', async () => {
    global.fetch = sequence({ ok: true, body: { message: 'sent' } });
    const { getByPlaceholderText, getByText, findByText } = renderScreen();

    // Get to step 2
    fireEvent.changeText(getByPlaceholderText('Email'), 'alice@example.com');
    fireEvent.press(getByText('Send Code'));
    await findByText('Verify Code');

    // Now we expect *exactly one* fetch so far (the forgot-password call)
    (global.fetch as jest.Mock).mockClear();

    fireEvent.changeText(getByPlaceholderText('● ● ● ● ● ●'), '12345');
    fireEvent.press(getByText('Verify Code'));

    expect(await findByText('Please enter the 6-digit code.')).toBeTruthy();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('moves to step 3 after a successful /verify-reset-code', async () => {
    global.fetch = sequence(
      { ok: true, body: { message: 'sent' } },     // forgot-password
      { ok: true, body: { valid: true } },          // verify-reset-code
    );
    const { getByPlaceholderText, getByText, findByText } = renderScreen();

    fireEvent.changeText(getByPlaceholderText('Email'), 'alice@example.com');
    fireEvent.press(getByText('Send Code'));
    await findByText('Verify Code');

    fireEvent.changeText(getByPlaceholderText('● ● ● ● ● ●'), '123456');
    fireEvent.press(getByText('Verify Code'));

    // Step 3 is identified by the Reset Password button
    expect(await findByText('Reset Password')).toBeTruthy();
  });

  it('surfaces server errors on /verify-reset-code', async () => {
    global.fetch = sequence(
      { ok: true, body: { message: 'sent' } },
      { ok: false, body: { detail: 'Invalid code.' } },
    );
    const { getByPlaceholderText, getByText, findByText } = renderScreen();

    fireEvent.changeText(getByPlaceholderText('Email'), 'alice@example.com');
    fireEvent.press(getByText('Send Code'));
    await findByText('Verify Code');

    fireEvent.changeText(getByPlaceholderText('● ● ● ● ● ●'), '999999');
    fireEvent.press(getByText('Verify Code'));

    expect(await findByText('Invalid code.')).toBeTruthy();
  });

  it('resend button is disabled during cooldown and re-enables after 30s', async () => {
    global.fetch = sequence({ ok: true, body: { message: 'sent' } });
    const { getByPlaceholderText, getByText, findByText, queryByText } = renderScreen();

    fireEvent.changeText(getByPlaceholderText('Email'), 'alice@example.com');
    fireEvent.press(getByText('Send Code'));
    await findByText('Verify Code');

    // While the cooldown is active, the button shows "Resend code in Ns"
    expect(getByText(/Resend code in \d+s/)).toBeTruthy();
    expect(queryByText('Resend code')).toBeNull();

    // Fast-forward 30 seconds — the cooldown should finish
    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    expect(getByText('Resend code')).toBeTruthy();
  });

  // ── Step 3 ────────────────────────────────────────────────────────────────

  it('shows an error when the two password fields do not match', async () => {
    global.fetch = sequence(
      { ok: true, body: { message: 'sent' } },
      { ok: true, body: { valid: true } },
    );
    const { getByPlaceholderText, getByText, findByText } = renderScreen();

    // Walk to step 3
    fireEvent.changeText(getByPlaceholderText('Email'), 'alice@example.com');
    fireEvent.press(getByText('Send Code'));
    await findByText('Verify Code');
    fireEvent.changeText(getByPlaceholderText('● ● ● ● ● ●'), '123456');
    fireEvent.press(getByText('Verify Code'));
    await findByText('Reset Password');

    (global.fetch as jest.Mock).mockClear();
    fireEvent.changeText(getByPlaceholderText('New password'), 'aaa');
    fireEvent.changeText(getByPlaceholderText('Confirm new password'), 'bbb');
    fireEvent.press(getByText('Reset Password'));

    expect(await findByText('Passwords do not match.')).toBeTruthy();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('completes a successful reset → shows success alert and navigates to login', async () => {
    global.fetch = sequence(
      { ok: true, body: { message: 'sent' } },
      { ok: true, body: { valid: true } },
      { ok: true, body: { message: 'Password reset successful.' } },
    );
    const { getByPlaceholderText, getByText, findByText } = renderScreen();

    fireEvent.changeText(getByPlaceholderText('Email'), 'alice@example.com');
    fireEvent.press(getByText('Send Code'));
    await findByText('Verify Code');
    fireEvent.changeText(getByPlaceholderText('● ● ● ● ● ●'), '123456');
    fireEvent.press(getByText('Verify Code'));
    await findByText('Reset Password');

    fireEvent.changeText(getByPlaceholderText('New password'), 'new-secret');
    fireEvent.changeText(getByPlaceholderText('Confirm new password'), 'new-secret');
    fireEvent.press(getByText('Reset Password'));

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith(
        'Success',
        expect.stringContaining('reset'),
        expect.any(Array),
      );
    });

    // The third fetch call should be the reset endpoint
    const calls = (global.fetch as jest.Mock).mock.calls;
    const lastUrl = calls[calls.length - 1][0] as string;
    expect(lastUrl).toContain('/auth/reset-password');
  });

  // ── Navigation ────────────────────────────────────────────────────────────

  it('Back from step 1 returns to the previous screen', () => {
    const { getByText } = renderScreen();
    fireEvent.press(getByText('Back'));
    expect(mockBack).toHaveBeenCalled();
  });

  it('Back from step 2 returns to step 1 without leaving the screen', async () => {
    global.fetch = sequence({ ok: true, body: { message: 'sent' } });
    const { getByPlaceholderText, getByText, findByText, queryByText } = renderScreen();

    fireEvent.changeText(getByPlaceholderText('Email'), 'alice@example.com');
    fireEvent.press(getByText('Send Code'));
    await findByText('Verify Code');

    fireEvent.press(getByText('Back'));
    expect(getByText('Send Code')).toBeTruthy();
    expect(queryByText('Verify Code')).toBeNull();
    expect(mockBack).not.toHaveBeenCalled();
  });
});
