/**
 * Phase 3 — notification tap routes to the map screen.
 *
 * The tap handler does two things: inject the alert into AlertsService
 * (so the in-app banner / siren auto-nav can fire) AND navigate the
 * user to the map. The notification-received handler from Phase 1 only
 * did the inject. One focused test that the tap path actually navigates.
 */
import { router } from 'expo-router';

import { AlertsService } from '@/services/AlertsService';
import { handleOrefNotificationTap } from '@/services/notifications';

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(),
  AndroidImportance: { MAX: 5 },
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  addNotificationReceivedListener: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(),
  getLastNotificationResponseAsync: jest.fn(),
}));

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
}));

const makeTapResponse = (data: Record<string, unknown>, title = '🚨 אזעקה') => ({
  notification: {
    request: { content: { title, body: 'אזורים: באר שבע', data } },
  },
} as any);

describe('handleOrefNotificationTap', () => {
  it('injects the alert AND routes to the map screen on an Oref-alert tap', () => {
    const injectSpy = jest.spyOn(AlertsService, 'injectAlert');
    const pushMock  = router.push as jest.Mock;
    pushMock.mockClear();

    try {
      const result = handleOrefNotificationTap(makeTapResponse({
        type:      'oref-alert',
        alertId:   'abc',
        alertKind: 'siren',
        areas:     ['באר שבע'],
      }));

      expect(result).toEqual({
        id: 'abc', kind: 'siren', title: '🚨 אזעקה', areas: ['באר שבע'],
      });
      expect(injectSpy).toHaveBeenCalledWith(result);
      // Map screen is where the alert subscriber lives — that's the
      // only place the banner + auto-nav fire from.
      expect(pushMock).toHaveBeenCalledWith('/(tabs)/map');
    } finally {
      injectSpy.mockRestore();
    }
  });

  it('does nothing for non-oref notifications (no inject, no navigate)', () => {
    const injectSpy = jest.spyOn(AlertsService, 'injectAlert');
    const pushMock  = router.push as jest.Mock;
    pushMock.mockClear();

    try {
      const result = handleOrefNotificationTap(makeTapResponse({
        type: 'report-update', reportId: 'r1',
      }));
      expect(result).toBeNull();
      expect(injectSpy).not.toHaveBeenCalled();
      expect(pushMock).not.toHaveBeenCalled();
    } finally {
      injectSpy.mockRestore();
    }
  });
});
