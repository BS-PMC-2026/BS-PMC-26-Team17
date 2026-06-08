/**
 * Uniform button used across every screen in the app.
 *
 * Variants:
 *   - primary   : filled brand blue (default Save / Confirm / main CTA)
 *   - secondary : white background, brand-blue outline (Manage / View / nav)
 *   - danger    : filled deep red (Logout / Cancel registration / Delete)
 *   - success   : filled forest green (Approve / Confirm safety)
 *   - ghost     : transparent, brand text only (subtle inline action)
 *
 * Sizes:
 *   - md (default) : 48px tall — the main button height across the app
 *   - sm           : 36px tall — compact inline action, paired with rows
 *
 * Why one component: keeps padding / radius / typography in lockstep so a
 * primary action looks identical on Settings, the Buildings Dashboard, the
 * navigate screen, etc. Touching a button anywhere becomes a one-prop change.
 */
import React from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { Palette, Radius, Spacing, Typography } from '@/constants/theme';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'success' | 'ghost';
export type ButtonSize = 'sm' | 'md';

type Props = {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  /** Optional leading glyph — e.g. an emoji or short icon string. */
  icon?: string;
  /** Override style — use sparingly (margin / width hacks only). */
  style?: ViewStyle;
  testID?: string;
  accessibilityLabel?: string;
};

export default function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  icon,
  style,
  testID,
  accessibilityLabel,
}: Props) {
  const isInactive = disabled || loading;
  const palette = VARIANT_STYLES[variant];

  return (
    <TouchableOpacity
      style={[
        styles.base,
        size === 'sm' ? styles.sizeSm : styles.sizeMd,
        { backgroundColor: palette.bg, borderColor: palette.border },
        isInactive && styles.disabled,
        style,
      ]}
      onPress={onPress}
      disabled={isInactive}
      activeOpacity={0.85}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: isInactive, busy: loading }}
    >
      {loading ? (
        <ActivityIndicator size="small" color={palette.fg} />
      ) : (
        <View style={styles.row}>
          {icon ? <Text style={[styles.icon, { color: palette.fg }]}>{icon}</Text> : null}
          <Text
            style={[
              size === 'sm' ? styles.labelSm : styles.labelMd,
              { color: palette.fg },
            ]}
            numberOfLines={1}
          >
            {label}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

type VariantPalette = { bg: string; fg: string; border: string };

const VARIANT_STYLES: Record<ButtonVariant, VariantPalette> = {
  primary:   { bg: Palette.brand,    fg: Palette.brandOn,    border: Palette.brand },
  secondary: { bg: Palette.card,     fg: Palette.brand,      border: Palette.brand },
  danger:    { bg: Palette.danger,   fg: Palette.textInverse,border: Palette.danger },
  success:   { bg: Palette.success,  fg: Palette.textInverse,border: Palette.success },
  ghost:     { bg: 'transparent',    fg: Palette.brand,      border: 'transparent' },
};

const styles = StyleSheet.create({
  base: {
    borderRadius: Radius.md,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sizeMd: {
    minHeight: 48,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  sizeSm: {
    minHeight: 36,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  disabled: { opacity: 0.5 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
  },
  icon:    { fontSize: 16, lineHeight: 20 },
  labelMd: { ...Typography.subheading } as TextStyle,
  labelSm: { ...Typography.bodyStrong } as TextStyle,
});
