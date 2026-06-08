/**
 * Uniform raised surface for grouping related controls / info on a screen.
 *
 * Use a Card around each logical section (e.g. "Home Address" form group on
 * Settings, "Stats" row on dashboards). Keeps spacing, radius, and elevation
 * consistent so the eye reads sections the same way everywhere.
 *
 * Pass `dark` on admin screens (Shelter Dashboard, Buildings Dashboard) so
 * the card swaps to `DarkPalette` and the border / shadow stay legible
 * against the slate-900 page background.
 */
import React from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { DarkPalette, Palette, Radius, Shadow, Spacing } from '@/constants/theme';

type Props = {
  children: React.ReactNode;
  /** Drop the outer margin — useful when the card sits inside another layout. */
  flush?: boolean;
  /** Render against `DarkPalette` for admin pages. */
  dark?: boolean;
  style?: ViewStyle;
};

export default function Card({ children, flush = false, dark = false, style }: Props) {
  const p = dark ? DarkPalette : Palette;
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: p.card, borderColor: p.borderSubtle },
        !flush && styles.spaced,
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.lg,
    padding:      Spacing.lg,
    borderWidth:  StyleSheet.hairlineWidth,
    ...Shadow.sm,
  },
  spaced: {
    marginBottom: Spacing.lg,
  },
});
