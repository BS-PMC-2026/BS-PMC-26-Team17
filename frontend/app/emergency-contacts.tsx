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

import Screen from '@/components/ui/Screen';
import ScreenHeader from '@/components/ui/ScreenHeader';
import { Palette, Radius, Spacing, Typography } from '@/constants/theme';

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
  return (
    <Screen variant="light">
      <ScreenHeader title="Emergency Contacts" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
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
                activeOpacity={0.85}
              >
                <View style={styles.rowText}>
                  <Text style={styles.rowName}>{item.name}</Text>
                  <Text style={styles.rowDesc} numberOfLines={2}>
                    {item.description}
                  </Text>
                </View>
                <Text style={styles.rowValue}>
                  {item.kind === 'phone' ? `📞 ${item.value}` : '💬 Chat'}
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
    </Screen>
  );
}

const styles = StyleSheet.create({
  scrollContent: { paddingBottom: Spacing.xxxl },

  subhead: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xs,
    ...Typography.caption,
    color: Palette.textSecondary,
  },

  section: { paddingTop: Spacing.md, paddingHorizontal: Spacing.lg },
  sectionTitle: {
    ...Typography.bodyStrong,
    color: Palette.textPrimary,
    marginBottom: Spacing.sm,
    letterSpacing: 0.3,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    backgroundColor: Palette.card,
    borderRadius: Radius.md,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: Palette.borderSubtle,
  },
  rowText: { flex: 1, paddingRight: Spacing.sm },
  rowName: {
    ...Typography.body,
    color: Palette.textPrimary,
    fontWeight: '600',
  },
  rowDesc: {
    ...Typography.small,
    color: Palette.textSecondary,
    marginTop: 2,
  },
  rowValue: {
    ...Typography.bodyStrong,
    color: Palette.danger,
  },

  disclaimer: {
    marginTop: Spacing.lg,
    marginHorizontal: Spacing.lg,
    padding: Spacing.md,
    backgroundColor: Palette.dangerSoft,
    borderLeftWidth: 4,
    borderLeftColor: Palette.danger,
    borderRadius: Radius.md,
    color: Palette.danger,
    ...Typography.small,
    lineHeight: 17,
  },
});
