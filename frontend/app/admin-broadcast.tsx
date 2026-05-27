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
  TouchableOpacity,
  StyleSheet,
  Alert,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { API_URL } from '@/config';
import { useAuth } from '@/context/auth';

export default function AdminBroadcastScreen() {
  const insets = useSafeAreaInsets();
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
      <View style={[styles.container, styles.center]}>
        <Text style={styles.deniedText}>Admins only.</Text>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtnLg}>
          <Text style={styles.backBtnText}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.container, { paddingTop: insets.top }]}
      contentContainerStyle={{ paddingBottom: 40 }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.headerRow}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.back()}
          testID="back-button"
          accessibilityLabel="Back"
        >
          <Text style={styles.backIcon}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.header}>Send Broadcast</Text>
        <View style={{ width: 36 }} />
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Title</Text>
        <TextInput
          style={styles.input}
          value={title}
          onChangeText={setTitle}
          placeholder="e.g. Emergency Drill Today"
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
          multiline
          maxLength={500}
          testID="body-input"
        />
        <Text style={styles.counter}>{body.length}/500</Text>
      </View>

      <TouchableOpacity
        style={[styles.sendBtn, !canSend && styles.sendBtnDisabled]}
        onPress={send}
        disabled={!canSend}
        testID="send-button"
      >
        {sending ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.sendBtnText}>Send to all users</Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  center: { justifyContent: 'center', alignItems: 'center', padding: 32 },
  deniedText: { fontSize: 16, color: '#666', marginBottom: 16 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backBtn: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backBtnLg: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: '#0a7ea4',
    borderRadius: 8,
  },
  backBtnText: { color: '#fff', fontWeight: '600' },
  backIcon: { fontSize: 28, color: '#0a7ea4' },
  header: { fontSize: 20, fontWeight: '700', color: '#222' },
  section: { paddingHorizontal: 16, marginTop: 16 },
  label: { fontSize: 14, fontWeight: '600', color: '#444', marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    backgroundColor: '#fafafa',
  },
  bodyInput: { minHeight: 120, textAlignVertical: 'top' },
  counter: { fontSize: 12, color: '#999', marginTop: 4, textAlign: 'right' },
  sendBtn: {
    marginHorizontal: 16,
    marginTop: 24,
    paddingVertical: 14,
    backgroundColor: '#0a7ea4',
    borderRadius: 10,
    alignItems: 'center',
  },
  sendBtnDisabled: { backgroundColor: '#9ec5d4' },
  sendBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
