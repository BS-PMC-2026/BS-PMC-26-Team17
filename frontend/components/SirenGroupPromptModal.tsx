import React, { useState, useEffect } from 'react';
import {
  Modal, View, Text, StyleSheet, TouchableOpacity, Pressable,
} from 'react-native';
import GroupSizeStepper from '@/components/GroupSizeStepper';

/**
 * Auto-popup shown on the navigate screen when a siren is in progress.
 *
 * Spec: "when the siren starts, send a popup that notifies them that a
 * siren has started and they should head to a shelter and prompt them to
 * select the number of people they are with."
 *
 * The map screen already POSTed a 1-person reservation as a default
 * before pushing the user here, so dismissing this modal without changing
 * anything is safe — the reservation stands. Tapping "אישור" fires
 * `onConfirm(groupSize)`, which re-POSTs to update the count.
 */

type Props = {
  visible: boolean;
  onConfirm: (groupSize: number) => void;
  onDismiss: () => void;
  initialGroupSize?: number;
};

export default function SirenGroupPromptModal({
  visible, onConfirm, onDismiss, initialGroupSize = 1,
}: Props) {
  const [groupSize, setGroupSize] = useState(initialGroupSize);
  useEffect(() => {
    if (visible) setGroupSize(initialGroupSize);
  }, [visible, initialGroupSize]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onDismiss}
    >
      <Pressable style={s.backdrop} onPress={onDismiss} testID="siren-prompt-backdrop">
        <Pressable style={s.card} onPress={() => { /* swallow */ }} testID="siren-prompt-card">
          <Text style={s.emoji}>🚨</Text>
          <Text style={s.title}>אזעקה!</Text>
          <Text style={s.body}>
            עליך להגיע למקלט באופן מיידי.{'\n'}
            כמה אנשים איתך?
          </Text>

          <View style={s.stepperWrap}>
            <GroupSizeStepper
              value={groupSize}
              onChange={setGroupSize}
              testIDPrefix="siren-prompt-group-size"
            />
          </View>

          <View style={s.actions}>
            <TouchableOpacity
              style={[s.btn, s.btnSecondary]}
              onPress={onDismiss}
              testID="siren-prompt-dismiss"
            >
              <Text style={[s.btnText, s.btnSecondaryText]}>סגור</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.btn, s.btnPrimary]}
              onPress={() => onConfirm(groupSize)}
              testID="siren-prompt-confirm"
            >
              <Text style={s.btnText}>אישור</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 22,
    alignItems: 'stretch',
  },
  emoji: { fontSize: 40, textAlign: 'center' },
  title: { fontSize: 22, fontWeight: '800', color: '#E24B4A', textAlign: 'center', marginTop: 4 },
  body:  { fontSize: 15, color: '#333', textAlign: 'center', marginTop: 10, marginBottom: 18, lineHeight: 22 },

  stepperWrap: { marginBottom: 18 },

  actions: { flexDirection: 'row', gap: 10 },
  btn: {
    flex: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center',
  },
  btnPrimary:        { backgroundColor: '#1a73e8' },
  btnSecondary:      { backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#cfd8dc' },
  btnText:           { color: '#fff', fontSize: 16, fontWeight: '700' },
  btnSecondaryText:  { color: '#555' },
});
