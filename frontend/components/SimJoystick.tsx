import React, { useRef } from 'react';
import { View, StyleSheet, PanResponder, Animated } from 'react-native';

/**
 * Virtual joystick for simulating GPS movement during manual QA of the
 * navigation flow. A circular pad with a draggable knob that snaps back
 * to the center on release.
 *
 * The component fires `onMove(dx, dy)` continuously while dragged, where
 * dx/dy are normalized to the range [-1, 1] (the edge of the pad).
 * `onStop` fires once when the touch ends and the knob recenters.
 */
type Props = {
  onMove: (dx: number, dy: number) => void;
  onStop?: () => void;
  size?: number;
};

const DEFAULT_SIZE = 120;

export default function SimJoystick({ onMove, onStop, size = DEFAULT_SIZE }: Props) {
  const radius     = size / 2;
  const knobSize   = size * 0.4;
  const knobRadius = knobSize / 2;
  // Max travel distance for the knob = pad radius minus knob radius
  const travel     = radius - knobRadius;

  const pan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder:  () => true,
      onPanResponderMove: (_evt, gesture) => {
        // Clamp the knob to inside the pad.
        let dx = gesture.dx;
        let dy = gesture.dy;
        const dist = Math.hypot(dx, dy);
        if (dist > travel) {
          const k = travel / dist;
          dx *= k;
          dy *= k;
        }
        pan.setValue({ x: dx, y: dy });
        // Normalize to -1..1 and fire callback. Caller decides what to do
        // with it (e.g. step a coordinate by some delta).
        onMove(dx / travel, dy / travel);
      },
      onPanResponderRelease: () => {
        Animated.spring(pan, {
          toValue: { x: 0, y: 0 },
          useNativeDriver: false,
          friction: 6,
        }).start();
        onStop?.();
      },
      onPanResponderTerminate: () => {
        Animated.spring(pan, {
          toValue: { x: 0, y: 0 },
          useNativeDriver: false,
          friction: 6,
        }).start();
        onStop?.();
      },
    })
  ).current;

  return (
    <View
      style={[
        styles.pad,
        { width: size, height: size, borderRadius: radius },
      ]}
      testID="sim-joystick"
    >
      <Animated.View
        {...panResponder.panHandlers}
        style={[
          styles.knob,
          {
            width: knobSize,
            height: knobSize,
            borderRadius: knobRadius,
            transform: pan.getTranslateTransform(),
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  pad: {
    backgroundColor: 'rgba(0, 0, 0, 0.18)',
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  knob: {
    backgroundColor: '#1a73e8',
    borderWidth: 2,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 4,
    elevation: 4,
  },
});
