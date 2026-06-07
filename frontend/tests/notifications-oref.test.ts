/**
 * Verifies the push-notification → AlertsService routing.
 *
 * Phase 1's whole job is "server push reaches the app on any screen".
 * That hinges on `handleOrefPushNotification` correctly converting an
 * Expo notification payload into a PikudAlert and calling
 * `AlertsService.injectAlert`. One focused test covers that contract.
 */
import { AlertsService } from '@/services/AlertsService';
import { handleOrefPushNotification } from '@/services/notifications';

// We don't need expo-notifications' actual permission machinery for this
// test — just the type of the notification we'd receive.
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(),
  AndroidImportance: { MAX: 5 },
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  addNotificationReceivedListener: jest.fn(),
}));

const makeNotification = (data: Record<string, unknown>, title = '🚨 אזעקה') => ({
  request: {
    content: { title, body: 'אזורים: באר שבע', data },
  },
} as any);

describe('handleOrefPushNotification', () => {
  it('builds a PikudAlert and feeds it into AlertsService.injectAlert', () => {
    const injectSpy = jest.spyOn(AlertsService, 'injectAlert');
    try {
      const result = handleOrefPushNotification(
        makeNotification({
          type:      'oref-alert',
          alertId:   '12345',
          alertKind: 'siren',
          areas:     ['באר שבע', 'עומר'],
        }),
      );

      expect(result).toEqual({
        id:    '12345',
        kind:  'siren',
        title: '🚨 אזעקה',
        areas: ['באר שבע', 'עומר'],
      });
      expect(injectSpy).toHaveBeenCalledWith(result);
    } finally {
      injectSpy.mockRestore();
    }
  });

  it('ignores notifications whose payload type is not oref-alert', () => {
    const injectSpy = jest.spyOn(AlertsService, 'injectAlert');
    try {
      const result = handleOrefPushNotification(
        makeNotification({ type: 'report-update', reportId: 'r1' }),
      );
      expect(result).toBeNull();
      expect(injectSpy).not.toHaveBeenCalled();
    } finally {
      injectSpy.mockRestore();
    }
  });
});
