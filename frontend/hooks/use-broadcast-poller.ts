/**
 * Polls the backend for new admin broadcasts every 15 seconds and shows
 * each one as a local notification. This is the Expo-Go-compatible
 * fallback for remote push: even when Expo's push pipeline doesn't
 * deliver to the phone, the broadcast still surfaces because the app
 * itself reads it from MongoDB and triggers the banner locally.
 *
 * Runs while the app is in the foreground only (Expo Go limitation).
 */
import { useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { API_URL } from '@/config';
import { useAuth } from '@/context/auth';

const POLL_INTERVAL_MS = 15_000;
const STORAGE_KEY_PREFIX = 'broadcasts:lastSeenAt:';

type Broadcast = {
  id: string;
  title: string;
  body: string;
  senderName: string;
  sentAt: string; // ISO-8601
};

async function fetchUnseen(after: string): Promise<Broadcast[]> {
  const url = `${API_URL}/api/broadcasts?after=${encodeURIComponent(after)}`;
  try {
    const r = await fetch(url);
    if (!r.ok) return [];
    const data = await r.json();
    return Array.isArray(data?.items) ? (data.items as Broadcast[]) : [];
  } catch {
    return [];
  }
}

async function showBroadcastNotification(b: Broadcast): Promise<void> {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: b.title,
        body: b.body,
        sound: 'default',
        data: { type: 'broadcast', broadcastId: b.id },
      },
      trigger: null,
    });
  } catch (e) {
    console.log('[broadcast] local notification failed:', e);
  }
}

export function useBroadcastPoller() {
  const { user } = useAuth();
  const userId = user?.id;
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!userId) return;
    const storageKey = `${STORAGE_KEY_PREFIX}${userId}`;
    let cancelled = false;

    const tick = async () => {
      let lastSeen = await AsyncStorage.getItem(storageKey);
      // First run for this user: skip historical broadcasts so they don't
      // get a flood on first login. Anchor the cursor to "now".
      if (!lastSeen) {
        lastSeen = new Date().toISOString();
        await AsyncStorage.setItem(storageKey, lastSeen);
        return;
      }

      const fresh = await fetchUnseen(lastSeen);
      if (cancelled || fresh.length === 0) return;

      for (const b of fresh) {
        await showBroadcastNotification(b);
      }
      // Advance the cursor to the latest sentAt we just processed
      const latestSentAt = fresh[fresh.length - 1].sentAt;
      await AsyncStorage.setItem(storageKey, latestSentAt);
    };

    // Run once immediately so the user doesn't wait a full interval
    tick().catch((e) => console.log('[broadcast] poll error:', e));
    intervalRef.current = setInterval(() => {
      tick().catch((e) => console.log('[broadcast] poll error:', e));
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [userId]);
}
