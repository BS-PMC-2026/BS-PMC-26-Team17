import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Pressable } from 'react-native';
import type { Alert as PikudAlert } from '@/services/AlertsService';

/**
 * Top-of-screen banner for incoming Pikud HaOref alerts.
 *
 * The same component handles both alert kinds; only the color and emoji
 * change so the user instantly sees whether it's a "be ready" warning or
 * an actual siren. Auto-dismisses after 60s, or whenever the user taps ✕.
 *
 * The banner is tappable when `onPress` is provided — used by the map
 * screen to open the appropriate action sheet (shelter list for early
 * warnings, transport-mode change for sirens). Tapping the ✕ close button
 * still dismisses without firing onPress.
 */
type Props = {
  alert: PikudAlert | null;
  onDismiss: () => void;
  onPress?: () => void;
};

const AUTO_DISMISS_MS = 60_000;

export default function AlertBanner({ alert, onDismiss, onPress }: Props) {
  const translateY = useRef(new Animated.Value(-140)).current;
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (alert) {
      // Slide down
      Animated.timing(translateY, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }).start();
      // Reset auto-dismiss every time a new alert arrives
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
      dismissTimer.current = setTimeout(onDismiss, AUTO_DISMISS_MS);
    } else {
      // Slide back up
      Animated.timing(translateY, {
        toValue: -140,
        duration: 200,
        useNativeDriver: true,
      }).start();
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
      dismissTimer.current = null;
    }
    return () => {
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
    };
  }, [alert, onDismiss, translateY]);

  if (!alert) {
    // Still render the animated view so the slide-up plays on dismiss
    return (
      <Animated.View
        style={[styles.wrap, { transform: [{ translateY }] }, styles.siren]}
        pointerEvents="none"
      />
    );
  }

  const isEarly = alert.kind === 'early';
  const bg     = isEarly ? styles.early   : styles.siren;
  const emoji  = isEarly ? '⚠️'          : '🚨';
  const label  = isEarly ? 'התרעה מוקדמת' : 'אזעקה';
  // Different hints by kind: pre-alarm sends users to pick a shelter,
  // siren is already auto-routing so tap = change transport mode.
  const hint   = isEarly
    ? 'הקש לבחירת מקלט קרוב'           // "Tap to pick a nearby shelter"
    : 'הקש לשינוי אופן הניווט';         // "Tap to change navigation mode"

  // The entire row is pressable when `onPress` is wired. The close ✕
  // stops propagation so dismiss never doubles as a tap.
  const Inner = (
    <View style={styles.row}>
      <Text style={styles.emoji}>{emoji}</Text>
      <View style={styles.textCol}>
        <Text style={styles.title}>{label}</Text>
        <Text style={styles.areas} numberOfLines={2}>
          {alert.areas.length > 0 ? alert.areas.join(', ') : alert.title}
        </Text>
        {onPress ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
      <TouchableOpacity
        style={styles.closeBtn}
        onPress={onDismiss}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        testID="alert-banner-close"
      >
        <Text style={styles.closeIcon}>✕</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <Animated.View
      style={[styles.wrap, bg, { transform: [{ translateY }] }]}
      testID="alert-banner"
    >
      {onPress ? (
        <Pressable
          onPress={onPress}
          testID="alert-banner-press"
          android_ripple={{ color: 'rgba(255,255,255,0.18)' }}
        >
          {Inner}
        </Pressable>
      ) : (
        Inner
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    paddingTop: 48,           // leaves room for the iOS status bar
    paddingBottom: 14,
    paddingHorizontal: 16,
    zIndex: 100,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 12,
  },
  siren: { backgroundColor: '#E24B4A' },
  early: { backgroundColor: '#F4A100' },

  row:     { flexDirection: 'row', alignItems: 'center' },
  emoji:   { fontSize: 28, marginRight: 12 },
  textCol: { flex: 1 },
  title:   { color: '#fff', fontSize: 16, fontWeight: '800' },
  areas:   { color: '#fff', fontSize: 13, marginTop: 2, opacity: 0.95 },
  hint:    { color: '#fff', fontSize: 12, marginTop: 4, opacity: 0.85,
             textDecorationLine: 'underline' },

  closeBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center', justifyContent: 'center',
    marginLeft: 8,
  },
  closeIcon: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
