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
  View,
} from 'react-native';
import { router } from 'expo-router';

import { useAuth } from '@/context/auth';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Screen from '@/components/ui/Screen';
import ScreenHeader from '@/components/ui/ScreenHeader';
import { Palette, Radius, Spacing, Typography } from '@/constants/theme';

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
    <Screen variant="light">
      <ScreenHeader title="Cancel Registration" />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {loading ? (
          <ActivityIndicator color={Palette.brand} style={{ marginTop: Spacing.xxl }} />
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
            <Text style={styles.sectionLabel}>Current registration</Text>
            <Card>
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
                last
              />
            </Card>

            {/* Reason (optional) */}
            <Card>
              <Text style={styles.label}>Reason for cancellation (optional)</Text>
              <Text style={styles.subtext}>
                Helps the admin understand why buildings get removed.
              </Text>
              <TextInput
                style={styles.input}
                placeholder="e.g., Building demolished, new manager, etc."
                placeholderTextColor={Palette.textTertiary}
                value={reason}
                onChangeText={setReason}
                multiline
              />
            </Card>

            {/* Actions */}
            <Button
              label="Keep registration"
              variant="secondary"
              onPress={() => router.back()}
              disabled={submitting}
              style={styles.keepCta}
            />
            <Button
              label="Cancel registration permanently"
              variant="danger"
              onPress={confirmCancel}
              loading={submitting}
              disabled={submitting}
              style={styles.cancelCta}
            />
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

function SummaryRow({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.summaryRow, last && styles.summaryRowLast]}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingHorizontal: Spacing.lg,
    paddingTop:        Spacing.md,
    paddingBottom:     Spacing.xxxl,
  },
  empty: {
    ...Typography.body,
    color: Palette.textSecondary,
    textAlign: 'center',
    marginTop: Spacing.xxl,
  },
  warningBanner: {
    backgroundColor:  Palette.dangerSoft,
    borderLeftWidth:  4,
    borderLeftColor:  Palette.danger,
    padding:          Spacing.md,
    borderRadius:     Radius.md,
    marginBottom:     Spacing.lg,
  },
  warningTitle: {
    ...Typography.bodyStrong,
    color: Palette.danger,
    marginBottom: Spacing.xs,
  },
  warningBody: {
    ...Typography.caption,
    color: Palette.danger,
    lineHeight: 19,
  },
  sectionLabel: {
    ...Typography.sectionLabel,
    color: Palette.textTertiary,
    marginBottom: Spacing.sm,
    paddingHorizontal: Spacing.xs,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Palette.borderSubtle,
  },
  summaryRowLast: { borderBottomWidth: 0 },
  summaryLabel: {
    ...Typography.caption,
    color: Palette.textTertiary,
    flex: 1,
  },
  summaryValue: {
    ...Typography.bodyStrong,
    fontSize: 13,
    color: Palette.textPrimary,
    flex: 2,
    textAlign: 'right',
  },
  label: {
    ...Typography.subheading,
    color: Palette.textPrimary,
    marginBottom: Spacing.xs,
  },
  subtext: {
    ...Typography.caption,
    color: Palette.textSecondary,
    marginBottom: Spacing.sm,
  },
  input: {
    backgroundColor: Palette.bgSubtle,
    borderWidth: 1,
    borderColor: Palette.borderSubtle,
    borderRadius: Radius.md,
    padding: Spacing.md,
    ...Typography.body,
    color: Palette.textPrimary,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  keepCta:   { marginTop: Spacing.sm },
  cancelCta: { marginTop: Spacing.sm },
});
