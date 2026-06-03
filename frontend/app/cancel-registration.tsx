// Cancel Building Registration screen (BSPMT17-374).
//
// Reached from Settings → "Cancel Registration". Shows a clear warning,
// a summary of the current registration, and an optional free-text reason
// that gets stored on the doc for admin review.
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/context/auth';

type Registration = {
  id: string;
  address?: string;
  city?: string;
  apartmentCount?: number;
  shelterLocation?: string;
  registeredAt?: string;
  registrationStatus?: string;
};

export default function CancelRegistrationScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [registration, setRegistration] = useState<Registration | null>(null);
  const [loading, setLoading] = useState(true);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Load the user's active registration so we know what we're cancelling
  // and can show a summary.
  useEffect(() => {
    (async () => {
      if (!user?.id) {
        setLoading(false);
        return;
      }
      try {
        const API_URL = process.env.EXPO_PUBLIC_API_URL ?? '';
        const res = await fetch(`${API_URL}/buildings/my/${user.id}`);
        if (!res.ok) return;
        const json = await res.json();
        setRegistration(json.registration || null);
      } catch {
        // ignore — UI will show "no active registration"
      } finally {
        setLoading(false);
      }
    })();
  }, [user?.id]);

  const doCancel = async () => {
    if (!registration || !user?.id) return;
    const API_URL = process.env.EXPO_PUBLIC_API_URL ?? '';
    setSubmitting(true);
    try {
      const res = await fetch(
        `${API_URL}/buildings/${registration.id}/cancel`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: user.id,
            reason: reason.trim() || null,
          }),
        },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        Alert.alert('Could not cancel', json.detail || 'Server error');
        return;
      }
      Alert.alert(
        'Registration cancelled',
        'Your building registration has been cancelled.',
        [{ text: 'OK', onPress: () => router.back() }],
      );
    } catch (e: any) {
      Alert.alert('Network error', String(e?.message || e));
    } finally {
      setSubmitting(false);
    }
  };

  // Two-step confirm: tapping the red button opens an Alert; only after
  // the destructive choice do we actually POST.
  const confirmCancel = () => {
    Alert.alert(
      'Are you sure?',
      'This will permanently cancel your building registration. You can register again later if needed.',
      [
        { text: 'Keep registration', style: 'cancel' },
        { text: 'Cancel permanently', style: 'destructive', onPress: doCancel },
      ],
    );
  };

  return (
    <ScrollView
      style={[styles.container, { paddingTop: insets.top }]}
      contentContainerStyle={{ paddingBottom: 40 }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.headerRow}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backIcon}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.header}>Cancel Registration</Text>
        <View style={{ width: 36 }} />
      </View>

      {loading ? (
        <ActivityIndicator color="#fff" style={{ marginTop: 40 }} />
      ) : !registration ? (
        <Text style={styles.empty}>
          You don&apos;t have an active building registration to cancel.
        </Text>
      ) : (
        <>
          {/* Warning banner */}
          <View style={styles.warningBanner}>
            <Text style={styles.warningTitle}>⚠️ Important</Text>
            <Text style={styles.warningBody}>
              Cancelling your registration will remove your building from the
              system. Emergency responders will no longer be able to direct
              people to your shelter during an alert.
            </Text>
          </View>

          {/* Registration summary */}
          <View style={styles.summary}>
            <Text style={styles.summaryTitle}>Current registration</Text>
            <SummaryRow label="Address" value={registration.address || '—'} />
            <SummaryRow label="City" value={registration.city || '—'} />
            <SummaryRow
              label="Apartments"
              value={String(registration.apartmentCount ?? '—')}
            />
            <SummaryRow
              label="Shelter Location"
              value={registration.shelterLocation || '—'}
            />
            <SummaryRow
              label="Status"
              value={registration.registrationStatus || 'pending'}
            />
          </View>

          {/* Reason (optional) */}
          <View style={styles.section}>
            <Text style={styles.label}>Reason for cancellation (optional)</Text>
            <Text style={styles.subtext}>
              Helps the admin understand why buildings get removed.
            </Text>
            <TextInput
              style={styles.input}
              placeholder="e.g., Building demolished, new manager, etc."
              value={reason}
              onChangeText={setReason}
              multiline
            />
          </View>

          {/* Actions */}
          <TouchableOpacity
            style={styles.keepBtn}
            onPress={() => router.back()}
            disabled={submitting}
          >
            <Text style={styles.keepBtnText}>Keep registration</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.cancelBtn, submitting && { opacity: 0.6 }]}
            onPress={confirmCancel}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.cancelBtnText}>
                Cancel registration permanently
              </Text>
            )}
          </TouchableOpacity>
        </>
      )}
    </ScrollView>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#181818', padding: 20 },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 18 },
  header: { fontSize: 22, fontWeight: 'bold', color: '#fff', flex: 1, textAlign: 'center' },
  backBtn: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: '#f2f2f2',
    alignItems: 'center', justifyContent: 'center',
  },
  backIcon: { fontSize: 28, color: '#1a73e8', lineHeight: 30, marginTop: -2 },
  empty: { color: '#ccc', textAlign: 'center', marginTop: 40, fontSize: 15 },
  warningBanner: {
    backgroundColor: '#3a1414',
    borderLeftWidth: 4,
    borderLeftColor: '#e24b4a',
    padding: 14,
    borderRadius: 6,
    marginBottom: 20,
  },
  warningTitle: { color: '#ffb4b4', fontSize: 14, fontWeight: '700', marginBottom: 6 },
  warningBody: { color: '#ffcfcf', fontSize: 13, lineHeight: 19 },
  summary: {
    backgroundColor: '#222',
    borderRadius: 8,
    padding: 14,
    marginBottom: 20,
  },
  summaryTitle: { color: '#ccc', fontSize: 13, fontWeight: '700', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 1 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  summaryLabel: { color: '#999', fontSize: 13, flex: 1 },
  summaryValue: { color: '#fff', fontSize: 13, fontWeight: '600', flex: 2, textAlign: 'right' },
  section: { marginBottom: 20 },
  label: { fontSize: 16, fontWeight: '600', color: '#eee', marginBottom: 6 },
  subtext: { fontSize: 12, color: '#999', marginBottom: 8 },
  input: {
    backgroundColor: '#fff', borderWidth: 1, borderColor: '#ddd',
    borderRadius: 8, padding: 12, fontSize: 15, minHeight: 70, textAlignVertical: 'top',
  },
  keepBtn: {
    backgroundColor: '#444', padding: 14, borderRadius: 8,
    alignItems: 'center', marginTop: 8, marginBottom: 10,
  },
  keepBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  cancelBtn: {
    backgroundColor: '#e24b4a', padding: 15, borderRadius: 8,
    alignItems: 'center', marginTop: 4,
  },
  cancelBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
