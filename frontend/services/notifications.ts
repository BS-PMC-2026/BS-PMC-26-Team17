/**
 * Push-notification glue: ask for permission, fetch the Expo push token,
 * and send it to the backend so the server can address pushes to this user.
 *
 * In Expo Go this works out of the box. In a standalone APK it requires
 * Firebase Cloud Messaging to be set up (google-services.json + EAS
 * credentials). We're deferring that until the feature works end-to-end.
 */
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000';

// Show notifications even when the app is in the foreground — without this
// they'd be silently delivered to handlers but never appear visually.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/**
 * Register this device for push notifications and send the token to the
 * backend. Safe to call multiple times — the backend overwrites the token
 * so a user switching devices stays reachable.
 *
 * Returns the token on success, null otherwise (denied permission,
 * simulator, etc.) so callers can decide whether to warn the user.
 */
export async function registerForPushNotifications(
  userId: string,
): Promise<string | null> {
  // Permission check — request only if not already granted/denied
  const { status: existing } = await Notifications.getPermissionsAsync();
  let granted = existing;
  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    granted = status;
  }
  if (granted !== 'granted') {
    console.log('[push] notification permission denied');
    return null;
  }

  // Android requires an explicit channel for foreground notifications
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#0a7ea4',
    });
  }

  // The projectId comes from `extra.eas.projectId` in app.json (set by `eas build:configure`)
  const projectId =
    (Constants.expoConfig as any)?.extra?.eas?.projectId ||
    (Constants as any).easConfig?.projectId;

  let token: string;
  try {
    const result = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    token = result.data;
  } catch (e) {
    // Common in simulators (no Google Play Services / not a real device)
    console.log('[push] failed to obtain push token:', e);
    return null;
  }

  // Persist on the backend
  try {
    await fetch(`${API_URL}/auth/push-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, push_token: token }),
    });
  } catch (e) {
    console.log('[push] failed to upload token:', e);
  }

  return token;
}

/**
 * Wipe the token on the server so notifications stop following this user.
 * Called from the auth context's logout flow.
 */
export async function clearPushNotifications(userId: string): Promise<void> {
  if (!userId) return;
  try {
    await fetch(`${API_URL}/auth/push-token/${userId}`, { method: 'DELETE' });
  } catch {
    // Logout shouldn't fail just because the server is unreachable
  }
}
