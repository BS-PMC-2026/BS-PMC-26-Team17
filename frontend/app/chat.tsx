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

import { API_URL } from '@/config';
import Screen from '@/components/ui/Screen';
import ScreenHeader from '@/components/ui/ScreenHeader';
import { Palette, Radius, Spacing, Typography } from '@/constants/theme';

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
    <Screen variant="light">
      <ScreenHeader title="Chat" />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
      >
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
            <ActivityIndicator size="small" color={Palette.brand} />
            <Text style={styles.loadingText}>Thinking…</Text>
          </View>
        )}

        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="Type a message…"
            placeholderTextColor={Palette.textTertiary}
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
            activeOpacity={0.85}
          >
            <Text style={styles.sendBtnText}>Send</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { flex: 1 },
  listContent: { padding: Spacing.md, paddingBottom: Spacing.lg },

  bubble: {
    maxWidth: '80%',
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  userBubble: {
    backgroundColor: Palette.brand,
    alignSelf: 'flex-end',
    borderBottomRightRadius: Radius.sm,
  },
  assistantBubble: {
    backgroundColor: Palette.bgSubtle,
    alignSelf: 'flex-start',
    borderBottomLeftRadius: Radius.sm,
  },
  bubbleText: { fontSize: 15, lineHeight: 20 },
  userText:      { color: Palette.brandOn },
  assistantText: { color: Palette.textPrimary },

  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xs,
  },
  loadingText: {
    ...Typography.caption,
    color: Palette.textSecondary,
    marginLeft: Spacing.sm,
  },

  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Palette.borderSubtle,
    backgroundColor: Palette.bg,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: Palette.borderSubtle,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.sm,
    ...Typography.body,
    color: Palette.textPrimary,
    backgroundColor: Palette.bgSubtle,
  },
  sendBtn: {
    marginLeft: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    height: 40,
    borderRadius: Radius.pill,
    backgroundColor: Palette.brand,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendBtnDisabled: { opacity: 0.5 },
  sendBtnText: {
    color: Palette.brandOn,
    fontWeight: '700',
  },
});
