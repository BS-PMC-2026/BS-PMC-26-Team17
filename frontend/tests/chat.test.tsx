import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';

import ChatScreen from '../app/chat';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.spyOn(Alert, 'alert').mockImplementation(() => {});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ChatScreen', () => {
  it('renders the initial greeting, input, and send button', () => {
    const { getByTestId, getByText } = render(<ChatScreen />);
    expect(getByTestId('chat-input')).toBeTruthy();
    expect(getByTestId('chat-send')).toBeTruthy();
    // Initial assistant greeting from the screen
    expect(getByText(/ToSafePlace/i)).toBeTruthy();
  });

  it('does not POST when the input is empty', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as any;

    const { getByTestId } = render(<ChatScreen />);
    await act(async () => {
      fireEvent.press(getByTestId('chat-send'));
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the user message + full history to /api/chat and renders the reply', async () => {
    const fetchMock = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ reply: "I'm here for you." }),
      } as Response),
    );
    global.fetch = fetchMock as any;

    const { getByTestId, getByText } = render(<ChatScreen />);
    fireEvent.changeText(getByTestId('chat-input'), 'I feel scared');

    await act(async () => {
      fireEvent.press(getByTestId('chat-send'));
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toContain('/api/chat');

    const body = JSON.parse(init.body as string);
    // History sent should include the initial greeting (assistant) + the
    // user's new message — in chronological order.
    expect(Array.isArray(body.messages)).toBe(true);
    expect(body.messages.length).toBeGreaterThanOrEqual(2);
    const last = body.messages[body.messages.length - 1];
    expect(last).toEqual({ role: 'user', content: 'I feel scared' });

    // Reply renders in a bubble
    await waitFor(() => {
      expect(getByText("I'm here for you.")).toBeTruthy();
    });
  });

  it('shows an alert when the server returns a non-OK response', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: false,
        json: () => Promise.resolve({ detail: 'Chat is not configured' }),
      } as Response),
    ) as any;

    const { getByTestId } = render(<ChatScreen />);
    fireEvent.changeText(getByTestId('chat-input'), 'hi');
    await act(async () => {
      fireEvent.press(getByTestId('chat-send'));
    });

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith(
        'Chat error',
        'Chat is not configured',
      );
    });
  });

  it('shows a network-error alert when fetch rejects', async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error('offline'))) as any;

    const { getByTestId } = render(<ChatScreen />);
    fireEvent.changeText(getByTestId('chat-input'), 'hi');
    await act(async () => {
      fireEvent.press(getByTestId('chat-send'));
    });

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith('Network error', 'offline');
    });
  });

  it('clears the input field after a successful send', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ reply: 'Sure.' }),
      } as Response),
    ) as any;

    const { getByTestId } = render(<ChatScreen />);
    const input = getByTestId('chat-input');
    fireEvent.changeText(input, 'hello');
    expect(input.props.value).toBe('hello');

    await act(async () => {
      fireEvent.press(getByTestId('chat-send'));
    });

    await waitFor(() => {
      expect(input.props.value).toBe('');
    });
  });

  it('sends history with each turn so context is preserved', async () => {
    let callCount = 0;
    const fetchMock = jest.fn(() => {
      callCount += 1;
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({ reply: `reply ${callCount}` }),
      } as Response);
    });
    global.fetch = fetchMock as any;

    const { getByTestId } = render(<ChatScreen />);

    // Turn 1
    fireEvent.changeText(getByTestId('chat-input'), 'first');
    await act(async () => {
      fireEvent.press(getByTestId('chat-send'));
    });
    await waitFor(() => expect(callCount).toBe(1));

    // Turn 2 — should send 4 messages: greeting + user1 + reply1 + user2
    fireEvent.changeText(getByTestId('chat-input'), 'second');
    await act(async () => {
      fireEvent.press(getByTestId('chat-send'));
    });
    await waitFor(() => expect(callCount).toBe(2));

    const secondCall = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    const body = JSON.parse(secondCall[1].body as string);
    expect(body.messages.length).toBe(4);
    expect(body.messages.map((m: any) => m.role)).toEqual([
      'assistant', // initial greeting
      'user',
      'assistant',
      'user',
    ]);
    expect(body.messages[body.messages.length - 1].content).toBe('second');
  });
});
