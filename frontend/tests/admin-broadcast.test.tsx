import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';

import AdminBroadcastScreen from '../app/admin-broadcast';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

// Auth context is read inline so we can flip role per-test.
const mockUseAuth = jest.fn();
jest.mock('@/context/auth', () => ({
  useAuth: () => mockUseAuth(),
}));

jest.spyOn(Alert, 'alert').mockImplementation(() => {});

beforeEach(() => {
  jest.clearAllMocks();
  mockUseAuth.mockReturnValue({
    user: { id: 'admin1', email: 'a@x.com', role: 'admin', name: 'Admin', telephone: '' },
  });
});

describe('AdminBroadcastScreen', () => {
  it('renders title + body inputs and a disabled send button initially', () => {
    const { getByTestId, getByText } = render(<AdminBroadcastScreen />);
    expect(getByTestId('title-input')).toBeTruthy();
    expect(getByTestId('body-input')).toBeTruthy();
    expect(getByText('Send to all users')).toBeTruthy();
  });

  it('blocks non-admin users with an explicit message', () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'u1', email: 'u@x.com', role: 'user', name: 'User', telephone: '' },
    });
    const { getByText, queryByTestId } = render(<AdminBroadcastScreen />);
    expect(getByText('Admins only.')).toBeTruthy();
    expect(queryByTestId('send-button')).toBeNull();
  });

  it('POSTs the typed message and shows a success alert', async () => {
    const fetchMock = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            status: 'ok',
            broadcast_id: 'b1',
            tokenCount: 5,
            pushedCount: 5,
          }),
      } as Response),
    );
    global.fetch = fetchMock as any;

    const { getByTestId } = render(<AdminBroadcastScreen />);
    fireEvent.changeText(getByTestId('title-input'), 'Drill at 10:00');
    fireEvent.changeText(getByTestId('body-input'), 'Practice run, no real alarm.');

    await act(async () => {
      fireEvent.press(getByTestId('send-button'));
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/admin/broadcast');
    const body = JSON.parse((init as any).body);
    expect(body).toEqual({
      admin_id: 'admin1',
      title: 'Drill at 10:00',
      body: 'Practice run, no real alarm.',
    });

    expect(Alert.alert).toHaveBeenCalledWith(
      'Sent',
      expect.stringContaining('5'),
      expect.any(Array),
    );
  });

  it('shows an error alert when the server responds non-OK', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: false,
        json: () => Promise.resolve({ detail: 'Only admins can broadcast' }),
      } as Response),
    ) as any;

    const { getByTestId } = render(<AdminBroadcastScreen />);
    fireEvent.changeText(getByTestId('title-input'), 't');
    fireEvent.changeText(getByTestId('body-input'), 'b');

    await act(async () => {
      fireEvent.press(getByTestId('send-button'));
    });

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith('Error', 'Only admins can broadcast');
    });
  });

  it('does not POST when title or body is empty', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as any;

    const { getByTestId } = render(<AdminBroadcastScreen />);
    // Only title — button should be disabled, press is a no-op
    fireEvent.changeText(getByTestId('title-input'), 'only title');

    await act(async () => {
      fireEvent.press(getByTestId('send-button'));
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
