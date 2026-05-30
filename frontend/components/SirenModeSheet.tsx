import React from 'react';
import {
  Modal, View, Text, StyleSheet, TouchableOpacity, Pressable,
} from 'react-native';

/**
 * Siren action sheet — shown when the user taps the "אזעקה" (siren)
 * banner. The siren flow already pushed the user into auto-navigation
 * using whatever mode is saved in settings. This sheet lets them
 * override it mid-route (e.g., "actually I'm in the car").
 *
 * Task-1 scope: only the 3 transport-mode buttons.
 * Task-2 will add a group-size stepper here.
 *
 * Picking a mode hands the choice back to the parent; the parent does
 * the actual re-navigation (router.replace) so the sim-joystick / fromLat
 * plumbing stays in one place (map.tsx).
 */

export type SettingsMode = 'walking' | 'cycling' | 'driving';

type ModeOption = { key: SettingsMode; icon: string; label: string };

const OPTIONS: ModeOption[] = [
  { key: 'walking', icon: '🚶', label: 'הליכה' },
  { key: 'cycling', icon: '🚴', label: 'אופניים' },
  { key: 'driving', icon: '🚗', label: 'רכב' },
];

type Props = {
  visible: boolean;
  onClose: () => void;
  onPick: (mode: SettingsMode) => void;
  currentMode: SettingsMode;
};

export default function SirenModeSheet({ visible, onClose, onPick, currentMode }: Props) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={s.backdrop} onPress={onClose} testID="siren-sheet-backdrop">
        <Pressable style={s.sheet} onPress={() => { /* swallow */ }}>
          <View style={s.handle} />
          <Text style={s.title}>שינוי אופן הניווט</Text>
          <Text style={s.sub}>נווט כעת אל המקלט הקרוב ביותר</Text>

          <View style={s.grid}>
            {OPTIONS.map(opt => {
              const active = opt.key === currentMode;
              return (
                <TouchableOpacity
                  key={opt.key}
                  style={[s.btn, active && s.btnActive]}
                  onPress={() => onPick(opt.key)}
                  testID={`siren-mode-${opt.key}`}
                >
                  <Text style={s.btnIcon}>{opt.icon}</Text>
                  <Text style={[s.btnLabel, active && s.btnLabelActive]}>{opt.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <TouchableOpacity style={s.cancel} onPress={onClose} testID="siren-sheet-cancel">
            <Text style={s.cancelText}>ביטול</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 28,
  },
  handle: {
    alignSelf: 'center',
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: '#ddd',
    marginBottom: 12,
  },
  title: { fontSize: 18, fontWeight: '800', color: '#222', textAlign: 'right' },
  sub:   { fontSize: 13, color: '#666', marginTop: 4, marginBottom: 18, textAlign: 'right' },

  grid: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 6,
  },
  btn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 18,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: '#e0e0e0',
    backgroundColor: '#fafafa',
  },
  btnActive:      { borderColor: '#1a73e8', backgroundColor: '#e8f0fe' },
  btnIcon:        { fontSize: 30, marginBottom: 6 },
  btnLabel:       { fontSize: 13, fontWeight: '600', color: '#555' },
  btnLabelActive: { color: '#1a73e8' },

  cancel: { paddingVertical: 14, alignItems: 'center', marginTop: 10 },
  cancelText: { color: '#888', fontSize: 15, fontWeight: '600' },
});
