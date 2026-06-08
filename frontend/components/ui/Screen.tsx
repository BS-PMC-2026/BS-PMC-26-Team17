/**
 * Top-level wrapper that every full-screen route should use.
 *
 * Solves two problems uniformly so individual screens don't reinvent them:
 *
 *  1. Safe areas. Reads `useSafeAreaInsets()` and pads the page so content
 *     never sits under the iPhone notch / rounded corners or the Android
 *     gesture-nav bar. The default applies top + bottom; pass `edges` to
 *     opt out of one side when a full-bleed layout needs it (e.g. the map
 *     screen's FAB stack that's already anchored to the bottom).
 *
 *  2. Light vs dark surface. `variant="light"` (default) uses the civic
 *     light palette. `variant="dark"` uses `DarkPalette` and reads as
 *     "admin-only" — the deliberate visual cue for the Shelter Dashboard
 *     and Buildings Dashboard. Status bar style flips to match so the
 *     phone's clock / battery icons stay legible against either bg.
 *
 * Usage:
 *
 *   <Screen variant="light">           // any user-facing page
 *     <ScreenHeader title="Settings" />
 *     <ScrollView>...</ScrollView>
 *   </Screen>
 *
 *   <Screen variant="dark" edges={['top']}>    // dashboard with sticky footer
 *     <ScreenHeader title="Shelters" dark />
 *     ...
 *   </Screen>
 */
import React, { createContext, useContext } from 'react';
import { StatusBar, StyleSheet, View, type ViewStyle } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import { DarkPalette, Palette } from '@/constants/theme';

// Read insets via the underlying context rather than `useSafeAreaInsets`
// directly, so:
//   - in production the value flows from <SafeAreaProvider> at the root
//   - in tests where the safe-area module is mocked WITHOUT exporting the
//     context, we fall back to a private zero-inset context instead of
//     crashing on `useContext(undefined)`.
const FALLBACK_INSETS = { top: 0, bottom: 0, left: 0, right: 0 } as const;
const FallbackInsetsContext = createContext(FALLBACK_INSETS);
const InsetsContext = SafeAreaInsetsContext ?? FallbackInsetsContext;

export type ScreenVariant = 'light' | 'dark';
export type ScreenEdge = 'top' | 'bottom' | 'left' | 'right';

type Props = {
  children: React.ReactNode;
  variant?: ScreenVariant;
  /** Which safe-area edges to pad. Defaults to top + bottom. */
  edges?: ScreenEdge[];
  /** Override style — usually unnecessary; the wrapper already flex:1's. */
  style?: ViewStyle;
};

export default function Screen({
  children,
  variant = 'light',
  edges = ['top', 'bottom'],
  style,
}: Props) {
  const insets = useContext(InsetsContext) ?? FALLBACK_INSETS;
  const palette = variant === 'dark' ? DarkPalette : Palette;

  const padding = {
    paddingTop:    edges.includes('top')    ? insets.top    : 0,
    paddingBottom: edges.includes('bottom') ? insets.bottom : 0,
    paddingLeft:   edges.includes('left')   ? insets.left   : 0,
    paddingRight:  edges.includes('right')  ? insets.right  : 0,
  };

  return (
    <View style={[styles.root, { backgroundColor: palette.bg }, padding, style]}>
      <StatusBar
        barStyle={variant === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={palette.bg}
        translucent={false}
      />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
