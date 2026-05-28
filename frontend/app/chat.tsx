/**
 * Conversational chat screen — talks to the backend's /api/chat, which
 * proxies to Claude (Anthropic). The full message history lives in
 * client state and is sent on every request, so the backend stays
 * stateless. RTL is handled per-bubble so Hebrew replies render
 * correctly without flipping the whole screen.
 */
import React, { useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { API_URL } from '@/config';

type Role = 'user' | 'assistant';
type Message = { id: string; role: Role; content: string };

// Cheap (Hebrew/Arabic) RTL heuristic so individual replies render
// with the right alignment without flipping the screen.
function isRTL(text: string): boolean {
  return /[֐-׿؀-ۿ]/.test(text);
}

let _idCounter = 0;
const nextId = () => `m_${Date.now()}_${++_idCounter}`;

export default function ChatScreen() {
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<Message[]>([
    {
      id: nextId(),
      role: 'assistant',
      content:
        "Hi! I'm here to help with safety questions about ToSafePlace. Ask me anything.",
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const listRef = useRef<FlatList<Message>>(null);

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({ animated: true });
    });
  }, []);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: Message = { id: nextId(), role: 'user', content: text };
    const history = [...messages, userMsg];
    setMessages(history);
    setInput('');
    setLoading(true);
    scrollToEnd();

    try {
      const r = await fetch(`${API_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Backend ignores message ids; only role+content are required.
          messages: history.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      const data = await r.json();

      if (!r.ok) {
        Alert.alert('Chat error', data?.detail || 'Something went wrong.');
        return;
      }
      const assistantMsg: Message = {
        id: nextId(),
        role: 'assistant',
        content: data.reply || '(no reply)',
      };
      setMessages([...history, assistantMsg]);
      scrollToEnd();
    } catch (e: any) {
      Alert.alert(
        'Network error',
        e?.message || 'Could not reach the server.',
      );
    } finally {
      setLoading(false);
    }
  };

  const renderItem = useCallback(({ item }: { item: Message }) => {
    const mine = item.role === 'user';
    const rtl = isRTL(item.content);
    return (
      <View
        style={[
          styles.bubble,
          mine ? styles.userBubble : styles.assistantBubble,
        ]}
      >
        <Text
          style={[
            styles.bubbleText,
            mine ? styles.userText : styles.assistantText,
            { writingDirection: rtl ? 'rtl' : 'ltr' },
          ]}
        >
          {item.content}
        </Text>
      </View>
    );
  }, []);

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
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
        <Text style={styles.header}>Chat</Text>
        <View style={{ width: 36 }} />
      </View>

      <FlatList
        ref={listRef}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        data={messages}
        keyExtractor={(m) => m.id}
        renderItem={renderItem}
        onContentSizeChange={scrollToEnd}
      />

      {loading && (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color="#0a7ea4" />
          <Text style={styles.loadingText}>Thinking…</Text>
        </View>
      )}

      <View style={[styles.inputRow, { paddingBottom: insets.bottom + 8 }]}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="Type a message…"
          multiline
          editable={!loading}
          testID="chat-input"
        />
        <TouchableOpacity
          onPress={send}
          disabled={!input.trim() || loading}
          style={[
            styles.sendBtn,
            (!input.trim() || loading) && styles.sendBtnDisabled,
          ]}
          testID="chat-send"
        >
          <Text style={styles.sendBtnText}>Send</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
  },
  backBtn: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backIcon: { fontSize: 28, color: '#0a7ea4' },
  header: { fontSize: 18, fontWeight: '700', color: '#222' },

  list: { flex: 1 },
  listContent: { padding: 12, paddingBottom: 20 },

  bubble: {
    maxWidth: '80%',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 8,
  },
  userBubble: {
    backgroundColor: '#0a7ea4',
    alignSelf: 'flex-end',
    borderBottomRightRadius: 4,
  },
  assistantBubble: {
    backgroundColor: '#f1f3f5',
    alignSelf: 'flex-start',
    borderBottomLeftRadius: 4,
  },
  bubbleText: { fontSize: 15, lineHeight: 20 },
  userText: { color: '#fff' },
  assistantText: { color: '#222' },

  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 6,
  },
  loadingText: { color: '#666', marginLeft: 8, fontSize: 13 },

  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 10,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#eee',
    backgroundColor: '#fff',
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 15,
    backgroundColor: '#fafafa',
  },
  sendBtn: {
    marginLeft: 8,
    paddingHorizontal: 18,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#0a7ea4',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendBtnDisabled: { backgroundColor: '#9ec5d4' },
  sendBtnText: { color: '#fff', fontWeight: '700' },
});
