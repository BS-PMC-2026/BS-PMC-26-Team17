/**
 * SimJoystick — ג׳ויסטיק מעגלי לסימולציית ניווט
 *
 * גרור את הכפתור לכיוון הרצוי — המיקום המדומה מתקדם בהתאם.
 * הכיוון מתואם לכיוון המצפן של המכשיר (heading-aware).
 * לחיצה ארוכה / גרירה נמשכת — מזיז ברציפות.
 *
 * להסרה: מחק את הקובץ + import + <SimJoystick .../> ב-navigate.tsx
 */

import { useEffect, useRef } from 'react';
import { View, StyleSheet, PanResponder, Animated } from 'react-native';
import * as Location from 'expo-location';

type Coord = { latitude: number; longitude: number };

interface Props {
  startCoords: Coord | null;
  onPositionChange: (c: Coord) => void;
}

const RADIUS   = 52;     // px — רדיוס ה-base
const MAX_STEP = 0.00022; // ~24 מ׳ בדחיפה מלאה
const TICK_MS  = 80;

export default function SimJoystick({ startCoords, onPositionChange }: Props) {
  const posRef      = useRef<Coord | null>(null);
  const headingRef  = useRef(0);                          // כיוון מצפן במעלות
  const deflRef     = useRef({ x: 0, y: 0 });            // דחיפה נוכחית (px)
  const stickPos    = useRef(new Animated.ValueXY()).current;
  const tickRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const headingSub  = useRef<{ remove: () => void } | null>(null);

  // ── אתחול מיקום ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (startCoords && !posRef.current) {
      posRef.current = { ...startCoords };
    }
  }, [startCoords]);

  // ── מנוי למצפן — ממתין לאישור הרשאה לפני ההרשמה ───────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (cancelled || status !== 'granted') return;
        const sub = await Location.watchHeadingAsync(h => {
          headingRef.current = h.trueHeading >= 0 ? h.trueHeading : h.magHeading;
        });
        if (cancelled) { sub.remove(); return; }
        headingSub.current = sub;
      } catch {
        // מצפן לא זמין — הג׳ויסטיק עובד עם כיוון צפון קבוע
      }
    })();
    return () => {
      cancelled = true;
      headingSub.current?.remove();
    };
  }, []);

  // ── Tick — מזיז את המיקום כל TICK_MS מ"ש ────────────────────────────────
  useEffect(() => {
    tickRef.current = setInterval(() => {
      const { x, y } = deflRef.current;
      const dist = Math.hypot(x, y);
      if (dist < 5 || !posRef.current) return;

      const norm = Math.min(dist / RADIUS, 1);  // 0–1
      const step = MAX_STEP * norm;

      // למעלה = צפון, ימינה = מזרח (ללא תיקון מצפן — יציב לבדיקות)
      const angle = Math.atan2(x, -y);

      const next: Coord = {
        latitude:  posRef.current.latitude  + Math.cos(angle) * step,
        longitude: posRef.current.longitude + Math.sin(angle) * step,
      };
      posRef.current = next;
      onPositionChange(next);
    }, TICK_MS);

    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, [onPositionChange]);

  // ── PanResponder ─────────────────────────────────────────────────────────
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder:  () => true,

      onPanResponderMove: (_, g) => {
        const dist  = Math.hypot(g.dx, g.dy);
        const clamp = dist > RADIUS ? RADIUS / dist : 1;
        const cx = g.dx * clamp;
        const cy = g.dy * clamp;
        deflRef.current = { x: cx, y: cy };
        stickPos.setValue({ x: cx, y: cy });
      },

      onPanResponderRelease: () => {
        deflRef.current = { x: 0, y: 0 };
        Animated.spring(stickPos, {
          toValue: { x: 0, y: 0 },
          useNativeDriver: true,
          tension: 120,
          friction: 8,
        }).start();
      },
    })
  ).current;

  if (!startCoords) return null;

  const BASE_SIZE  = RADIUS * 2 + 12;
  const STICK_SIZE = 46;

  return (
    <View style={s.wrap}>
      <View
        style={[s.base, { width: BASE_SIZE, height: BASE_SIZE, borderRadius: BASE_SIZE / 2 }]}
        {...pan.panHandlers}
      >
        <Animated.View
          style={[
            s.stick,
            { width: STICK_SIZE, height: STICK_SIZE, borderRadius: STICK_SIZE / 2 },
            { transform: [{ translateX: stickPos.x }, { translateY: stickPos.y }] },
          ]}
        />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    position: 'absolute',
    bottom: 110,
    left: 20,
  },
  base: {
    backgroundColor: '#ffffffbb',
    borderWidth: 2,
    borderColor: '#1a73e844',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 8,
  },
  stick: {
    backgroundColor: '#1a73e8dd',
    borderWidth: 3,
    borderColor: '#fff',
    shadowColor: '#1a73e8',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 4,
  },
});
