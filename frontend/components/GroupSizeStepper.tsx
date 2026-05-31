import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

/**
 * Reusable "- N +" stepper for entering how many people the user is with.
 *
 * Range is clamped [1, 20] — matches the backend's POST /shelters/{id}/reserve
 * Pydantic validation (group_size: int, ge=1, le=20). Hold-to-repeat is NOT
 * implemented; the range is small enough that tap-tap-tap is fine.
 */

type Props = {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  /** Optional test prefix so callers in different sheets get unique testIDs. */
  testIDPrefix?: string;
};

export default function GroupSizeStepper({
  value, onChange, min = 1, max = 20, testIDPrefix = 'group-size',
}: Props) {
  const clamped = Math.max(min, Math.min(max, value));
  const dec = () => onChange(Math.max(min, clamped - 1));
  const inc = () => onChange(Math.min(max, clamped + 1));

  return (
    <View style={s.wrap} testID={`${testIDPrefix}-stepper`}>
      <Text style={s.label}>אנשים איתי</Text>
      <View style={s.controls}>
        <TouchableOpacity
          style={[s.btn, clamped <= min && s.btnDisabled]}
          onPress={dec}
          disabled={clamped <= min}
          testID={`${testIDPrefix}-dec`}
          accessibilityLabel="decrement people count"
        >
          <Text style={s.btnText}>−</Text>
        </TouchableOpacity>
        <Text style={s.value} testID={`${testIDPrefix}-value`}>{clamped}</Text>
        <TouchableOpacity
          style={[s.btn, clamped >= max && s.btnDisabled]}
          onPress={inc}
          disabled={clamped >= max}
          testID={`${testIDPrefix}-inc`}
          accessibilityLabel="increment people count"
        >
          <Text style={s.btnText}>+</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    paddingVertical: 12,
    backgroundColor: '#f5f7fa',
    borderRadius: 12,
  },
  label: {
    fontSize: 15,
    fontWeight: '600',
    color: '#222',
    marginRight: 12,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 8,
  },
  btn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#1a73e8',
    alignItems: 'center', justifyContent: 'center',
  },
  btnDisabled: { backgroundColor: '#c6d6f0' },
  btnText: { color: '#fff', fontSize: 22, fontWeight: '700', lineHeight: 24 },
  value: {
    minWidth: 36,
    textAlign: 'center',
    fontSize: 18, fontWeight: '700', color: '#222',
    marginHorizontal: 8,
  },
});
