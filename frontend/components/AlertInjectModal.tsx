import React from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { AlertsService } from '@/services/AlertsService';

/**
 * Demo modal — opens from the 🚨 button on the map. Lets the lecturer
 * (or any tester) inject either an early-warning or an actual-siren alert
 * so the banner can be demonstrated without waiting for a real attack.
 */
type Props = {
  visible: boolean;
  onClose: () => void;
  /** Pikud HaOref zone name to inject the alert with. Defaults to "באר שבע"
   *  for back-compat with callers that didn't yet compute the user's zone. */
  area?: string;
};

export default function AlertInjectModal({ visible, onClose, area = 'באר שבע' }: Props) {
  const fire = (kind: 'early' | 'siren') => {
    AlertsService.injectFakeAlert(kind, area);
    onClose();
  };

  return (
    <Modal
      animationType="fade"
      transparent
      visible={visible}
      onRequestClose={onClose}
    >
      <View style={s.backdrop}>
        <View style={s.card} testID="alert-inject-modal">
          <Text style={s.title}>Simulate an alert</Text>
          <Text style={s.sub}>
            For demos — fires the banner immediately.{'\n'}
            Zone: <Text style={s.zone}>{area}</Text>
          </Text>

          <TouchableOpacity
            style={[s.btn, s.early]}
            onPress={() => fire('early')}
            testID="inject-early"
          >
            <Text style={s.btnText}>⚠️ התרעה מוקדמת</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[s.btn, s.siren]}
            onPress={() => fire('siren')}
            testID="inject-siren"
          >
            <Text style={s.btnText}>🚨 אזעקה בפועל</Text>
          </TouchableOpacity>

          <TouchableOpacity style={s.cancel} onPress={onClose} testID="inject-cancel">
            <Text style={s.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 22,
  },
  title: { fontSize: 18, fontWeight: '700', color: '#222', textAlign: 'center' },
  sub:   { fontSize: 13, color: '#666', textAlign: 'center', marginTop: 6, marginBottom: 18 },
  zone:  { fontWeight: '700', color: '#222' },

  btn: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 10,
  },
  early: { backgroundColor: '#F4A100' },
  siren: { backgroundColor: '#E24B4A' },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  cancel: { paddingVertical: 12, alignItems: 'center', marginTop: 6 },
  cancelText: { color: '#888', fontSize: 15, fontWeight: '600' },
});
