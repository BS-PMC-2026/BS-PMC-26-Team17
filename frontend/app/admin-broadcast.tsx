/**
 * Admin-only screen: type a title + body, send a push notification to
 * every user with a registered Expo push token. The same message is also
 * stored in MongoDB so phones that poll (e.g. Expo Go on iPhone, where
 * remote push doesn't deliver) can surface it as a local notification.
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Alert,
  ScrollView,
} from 'react-native';
import { router } from 'expo-router';

import { API_URL } from '@/config';
import { useAuth } from '@/context/auth';
import Button from '@/components/ui/Button';
import Screen from '@/components/ui/Screen';
import ScreenHeader from '@/components/ui/ScreenHeader';
import { Palette, Radius, Spacing, Typography } from '@/constants/theme';

export default function AdminBroadcastScreen() {
  const { user } = useAuth();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);

  const canSend =
    title.trim().length > 0 && body.trim().length > 0 && !sending;

  const send = async () => {
    if (!user?.id) return;
    setSending(true);
    try {
      const res = await fetch(`${API_URL}/api/admin/broadcast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          admin_id: user.id,
          title: title.trim(),
          body: body.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        Alert.alert('Error', data?.detail || 'Failed to send broadcast');
        return;
      }
      Alert.alert(
        'Sent',
        `Broadcast saved. ${data.tokenCount} user(s) targeted, ${data.pushedCount} reached via push.`,
        [{ text: 'OK', onPress: () => router.back() }],
      );
      setTitle('');
      setBody('');
    } catch (e: any) {
      Alert.alert('Network error', e?.message || 'Could not reach the server');
    } finally {
      setSending(false);
    }
  };

  if (user?.role !== 'admin') {
    return (
      <Screen variant="light">
        <ScreenHeader title="Send Broadcast" />
        <View style={styles.center}>
          <Text style={styles.deniedText}>Admins only.</Text>
          <Button label="Go back" onPress={() => router.back()} variant="primary" />
        </View>
      </Screen>
    );
  }

  return (
    <Screen variant="light">
      <ScreenHeader title="Send Broadcast" />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.section}>
          <Text style={styles.label}>Title</Text>
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder="e.g. Emergency Drill Today"
            placeholderTextColor={Palette.textTertiary}
            maxLength={80}
            autoCorrect={false}
            testID="title-input"
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Message</Text>
          <TextInput
            style={[styles.input, styles.bodyInput]}
            value={body}
            onChangeText={setBody}
            placeholder="Type the message your users will see…"
            placeholderTextColor={Palette.textTertiary}
            multiline
            maxLength={500}
            testID="body-input"
          />
          <Text style={styles.counter}>{body.length}/500</Text>
        </View>

        <Button
          label="Send to all users"
          icon="📣"
          variant="primary"
          onPress={send}
          loading={sending}
          disabled={!canSend}
          style={styles.sendCta}
          testID="send-button"
        />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.xxl, gap: Spacing.md },
  deniedText: { ...Typography.body, color: Palette.textSecondary },
  scrollContent: { paddingBottom: Spacing.xxxl },
  section: { paddingHorizontal: Spacing.lg, marginTop: Spacing.lg },
  label: {
    ...Typography.subheading,
    color: Palette.textPrimary,
    marginBottom: Spacing.xs,
  },
  input: {
    borderWidth: 1,
    borderColor: Palette.borderSubtle,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    ...Typography.body,
    color: Palette.textPrimary,
    backgroundColor: Palette.bgSubtle,
  },
  bodyInput: { minHeight: 140, textAlignVertical: 'top' },
  counter: {
    ...Typography.small,
    color: Palette.textTertiary,
    marginTop: Spacing.xs,
    textAlign: 'right',
  },
  sendCta: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.xl,
  },
});
