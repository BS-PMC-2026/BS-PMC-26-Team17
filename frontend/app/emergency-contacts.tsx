/**
 * Quick-access list of Israeli emergency and mental-health support
 * lines. Tapping a row opens the system dialer (or browser for chat-
 * only services). One short tap = one call — designed for stress
 * situations where extra taps are friction.
 *
 * Numbers and resources are pinned in code rather than fetched so the
 * screen still works fully offline.
 */
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Linking,
  Alert,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Contact = {
  name: string;
  description: string;
  // Either a phone number (digits/star/hash only) or a website URL.
  // Use `kind` to disambiguate.
  value: string;
  kind: 'phone' | 'web';
};

type Section = {
  title: string;
  icon: string;
  items: Contact[];
};

const SECTIONS: Section[] = [
  {
    title: 'Emergency services',
    icon: '🚨',
    items: [
      {
        name: 'משטרה · Police',
        description: 'Police emergency',
        value: '100',
        kind: 'phone',
      },
      {
        name: 'מד״א · Magen David Adom',
        description: 'Ambulance / medical emergency',
        value: '101',
        kind: 'phone',
      },
      {
        name: 'כבאות · Fire',
        description: 'Fire and rescue',
        value: '102',
        kind: 'phone',
      },
      {
        name: 'פיקוד העורף · Home Front Command',
        description: 'Civil defense info line',
        value: '104',
        kind: 'phone',
      },
    ],
  },
  {
    title: 'Emotional support',
    icon: '🫂',
    items: [
      {
        name: 'ער״ן · ERAN',
        description:
          'Emotional first aid — anonymous, 24/7. עזרה ראשונה נפשית.',
        value: '*1201',
        kind: 'phone',
      },
      {
        name: 'סה״ר · Sahar (online chat)',
        description:
          'Anonymous online emotional support — via chat / WhatsApp.',
        value: 'https://sahar.org.il',
        kind: 'web',
      },
      {
        name: 'נט״ל · NATAL',
        description:
          'Anxiety and national-trauma support line. סיוע רגשי לנפגעי חרדה וטראומה.',
        value: '*3362',
        kind: 'phone',
      },
    ],
  },
  {
    title: 'Health-fund mental support',
    icon: '🏥',
    items: [
      {
        name: 'כללית · Clalit',
        description: 'Up to 3 free emotional-support calls',
        value: '*8703',
        kind: 'phone',
      },
      {
        name: 'מכבי · Maccabi',
        description: 'Up to 3 free emotional-support calls',
        value: '*3555',
        kind: 'phone',
      },
      {
        name: 'מאוחדת · Meuhedet',
        description: 'Up to 3 free emotional-support calls',
        value: '*3833',
        kind: 'phone',
      },
      {
        name: 'לאומית · Leumit',
        description: 'Up to 3 free emotional-support calls',
        value: '*507',
        kind: 'phone',
      },
    ],
  },
];

async function open(contact: Contact) {
  const url =
    contact.kind === 'phone' ? `tel:${contact.value}` : contact.value;
  try {
    const supported = await Linking.canOpenURL(url);
    if (!supported) {
      Alert.alert(
        'Cannot open',
        contact.kind === 'phone'
          ? `Your device doesn't expose a dialer. The number is ${contact.value}.`
          : `Can't open ${contact.value}.`,
      );
      return;
    }
    await Linking.openURL(url);
  } catch {
    Alert.alert('Error', 'Something went wrong opening that contact.');
  }
}

export default function EmergencyContactsScreen() {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={[styles.container, { paddingTop: insets.top }]}
      contentContainerStyle={{ paddingBottom: 40 }}
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
        <Text style={styles.header}>🆘 Emergency contacts</Text>
        <View style={{ width: 36 }} />
      </View>

      <Text style={styles.subhead}>
        Tap any line to call (or open the chat for Sahar).
      </Text>

      {SECTIONS.map((section) => (
        <View key={section.title} style={styles.section}>
          <Text style={styles.sectionTitle}>
            {section.icon}  {section.title}
          </Text>
          {section.items.map((item) => (
            <TouchableOpacity
              key={`${section.title}-${item.name}`}
              style={styles.row}
              onPress={() => open(item)}
              testID={`contact-${item.value}`}
            >
              <View style={styles.rowText}>
                <Text style={styles.rowName}>{item.name}</Text>
                <Text style={styles.rowDesc} numberOfLines={2}>
                  {item.description}
                </Text>
              </View>
              <Text style={styles.rowValue}>
                {item.kind === 'phone' ? `📞 ${item.value}` : '💬 Open chat'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      ))}

      <Text style={styles.disclaimer}>
        For immediate danger, call 101 (MDA) or 100 (Police).{'\n'}
        If you&apos;re in physical danger right now, take shelter first.
      </Text>
    </ScrollView>
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
  backIcon: { fontSize: 28, color: '#c0392b' },
  header: { fontSize: 18, fontWeight: '700', color: '#222' },

  subhead: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 4,
    color: '#666',
    fontSize: 13,
  },

  section: { paddingTop: 14, paddingHorizontal: 16 },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#222',
    marginBottom: 8,
    letterSpacing: 0.3,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 14,
    backgroundColor: '#fafafa',
    borderRadius: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#eee',
  },
  rowText: { flex: 1, paddingRight: 10 },
  rowName: { fontSize: 15, fontWeight: '600', color: '#222' },
  rowDesc: { fontSize: 12, color: '#666', marginTop: 2 },
  rowValue: { fontSize: 14, fontWeight: '700', color: '#c0392b' },

  disclaimer: {
    marginTop: 24,
    marginHorizontal: 16,
    padding: 12,
    backgroundColor: '#fff4f4',
    borderLeftWidth: 4,
    borderLeftColor: '#c0392b',
    borderRadius: 6,
    color: '#7a1f1f',
    fontSize: 12,
    lineHeight: 17,
  },
});
