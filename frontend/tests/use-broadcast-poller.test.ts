/**
 * Unit tests for use-broadcast-poller. We render the hook through a
 * tiny test component so we can drive its lifecycle, and assert that:
 *   - On the very first run (no stored cursor), it anchors at "now" and
 *     does NOT show historical broadcasts.
 *   - On subsequent ticks, each fresh broadcast triggers a local
 *     notification, and the cursor advances to the latest sentAt.
 *   - When `after` already covers all broadcasts, no notification fires.
 */
import React from 'react';
import { render, waitFor, act } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';

import { useBroadcastPoller } from '../hooks/use-broadcast-poller';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
}));

jest.mock('expo-notifications', () => ({
  scheduleNotificationAsync: jest.fn(() => Promise.resolve()),
}));

const mockUseAuth = jest.fn();
jest.mock('@/context/auth', () => ({
  useAuth: () => mockUseAuth(),
}));

// Tiny wrapper so we can mount the hook.
function HookHost() {
  useBroadcastPoller();
  return null;
}

const asMock = <T,>(v: T) => v as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  mockUseAuth.mockReturnValue({
    user: { id: 'u1', email: 'u@x.com', role: 'user', name: 'U', telephone: '' },
  });
  global.fetch = jest.fn() as any;
});

afterEach(() => {
  jest.useRealTimers();
});

describe('useBroadcastPoller', () => {
  it('does nothing when there is no logged-in user', async () => {
    mockUseAuth.mockReturnValue({ user: null });
    asMock(AsyncStorage.getItem).mockResolvedValue(null);
    render(React.createElement(HookHost));
    await act(async () => {
      await Promise.resolve();
    });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('first run anchors the cursor and skips historical broadcasts', async () => {
    // No stored timestamp → first run path
    asMock(AsyncStorage.getItem).mockResolvedValue(null);

    render(React.createElement(HookHost));

    // Let the initial tick microtasks resolve
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Cursor was written to AsyncStorage…
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      expect.stringContaining('broadcasts:lastSeenAt:u1'),
      expect.any(String),
    );
    // …but no fetch and no notification yet (anchor-only first run)
    expect(global.fetch).not.toHaveBeenCalled();
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('shows local notifications for each fresh broadcast and advances cursor', async () => {
    // Existing cursor — the hook will fetch new items strictly after this
    asMock(AsyncStorage.getItem).mockResolvedValue('2026-05-27T10:00:00.000Z');

    const items = [
      {
        id: 'b1',
        title: 'Drill',
        body: 'Practice',
        senderName: 'Admin',
        sentAt: '2026-05-27T10:05:00.000Z',
      },
      {
        id: 'b2',
        title: 'Update',
        body: 'New shelter open',
        senderName: 'Admin',
        sentAt: '2026-05-27T10:10:00.000Z',
      },
    ];
    asMock(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ items }),
    } as Response);

    render(React.createElement(HookHost));

    // First tick runs immediately on mount
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Fetch was called with `after` set to the stored cursor
    expect(global.fetch).toHaveBeenCalled();
    const url = String((global.fetch as jest.Mock).mock.calls[0][0]);
    expect(url).toContain('/api/broadcasts?after=');
    expect(decodeURIComponent(url)).toContain('2026-05-27T10:00:00.000Z');

    // One local notification per broadcast
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(2);
    const firstCall = asMock(Notifications.scheduleNotificationAsync).mock.calls[0][0];
    expect(firstCall.content.title).toBe('Drill');
    expect(firstCall.content.data).toEqual({ type: 'broadcast', broadcastId: 'b1' });

    // Cursor advanced to the latest sentAt
    const setCalls = asMock(AsyncStorage.setItem).mock.calls;
    expect(setCalls[setCalls.length - 1]).toEqual([
      'broadcasts:lastSeenAt:u1',
      '2026-05-27T10:10:00.000Z',
    ]);
  });

  it('fires nothing when the server returns an empty list', async () => {
    asMock(AsyncStorage.getItem).mockResolvedValue('2026-05-27T11:00:00.000Z');
    asMock(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ items: [] }),
    } as Response);

    render(React.createElement(HookHost));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });
});
