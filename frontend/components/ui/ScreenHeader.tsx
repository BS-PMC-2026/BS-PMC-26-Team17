/**
 * Uniform back-arrow + title row used at the top of every sub-screen.
 *
 * Why a dedicated component: the old version was repeated inline in every
 * file with subtly different paddings, button sizes, and icon colors. This
 * keeps them all visually identical and gives us one place to tweak.
 *
 * Pass `dark` when the surrounding `Screen` is in dark mode so the title
 * and back button stay legible on the slate-900 page background.
 */
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View, type ViewStyle } from 'react-native';
import { router } from 'expo-router';

import { DarkPalette, Palette, Radius, Spacing, Typography } from '@/constants/theme';

type Props = {
  title: string;
  /** Hide the back button on root tabs that don't have somewhere to go back to. */
  showBack?: boolean;
  /** Override for custom back handlers — defaults to expo-router's `back()`. */
  onBack?: () => void;
  /** Optional trailing element (e.g. an action button) shown on the right. */
  trailing?: React.ReactNode;
  /** Render against `DarkPalette` for admin pages. */
  dark?: boolean;
  style?: ViewStyle;
};

export default function ScreenHeader({
  title,
  showBack = true,
  onBack,
  trailing,
  dark = false,
  style,
}: Props) {
  const p = dark ? DarkPalette : Palette;
  return (
    <View style={[styles.row, { backgroundColor: p.bg }, style]}>
      {showBack ? (
        <TouchableOpacity
          style={[
            styles.iconBtn,
            { backgroundColor: p.card, borderColor: p.borderSubtle },
          ]}
          onPress={onBack ?? (() => router.back())}
          testID="back-button"
          accessibilityLabel="Back"
          accessibilityRole="button"
        >
          <Text style={[styles.backIcon, { color: p.brand }]}>‹</Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.iconSlot} />
      )}

      <Text style={[styles.title, { color: p.textPrimary }]} numberOfLines={1}>{title}</Text>

      <View style={styles.iconSlot}>{trailing ?? null}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  iconSlot: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  backIcon: {
    fontSize: 28,
    lineHeight: 30,
    marginTop: -2,
  },
  title: {
    flex: 1,
    ...Typography.title,
    textAlign: 'center',
  },
});
