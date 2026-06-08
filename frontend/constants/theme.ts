/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import { Platform } from 'react-native';

const tintColorLight = '#0a7ea4';
const tintColorDark = '#fff';

export const Colors = {
  light: {
    text: '#11181C',
    background: '#fff',
    tint: tintColorLight,
    icon: '#687076',
    tabIconDefault: '#687076',
    tabIconSelected: tintColorLight,
  },
  dark: {
    text: '#ECEDEE',
    background: '#151718',
    tint: tintColorDark,
    icon: '#9BA1A6',
    tabIconDefault: '#9BA1A6',
    tabIconSelected: tintColorDark,
  },
};

// ─── ToSafePlace design system ──────────────────────────────────────────────
//
// "Calm civic / safety" palette: light, generously spaced, soft civic blues,
// rounded but not playful. Read as a public-utility app, not a consumer toy.
//
// Every UI component imports from here. If a hex code shows up inline anywhere
// outside this file, it's a bug — open the theme and add a token instead so
// the next palette tweak is a one-file change.

export const Palette = {
  // Surfaces
  bg:          '#F5F7FA', // page background
  bgSubtle:    '#EEF2F7', // alternating rows, subtle panels
  card:        '#FFFFFF',
  overlay:     'rgba(15, 23, 42, 0.55)', // modal backdrop

  // Text
  textPrimary:   '#0F172A',
  textSecondary: '#475569',
  textTertiary:  '#94A3B8',
  textInverse:   '#FFFFFF',

  // Brand — deep civic blue, like a road sign
  brand:        '#1E3A8A',
  brandPressed: '#1E40AF',
  brandSoft:    '#DBEAFE',
  brandOn:      '#FFFFFF', // text color used on brand backgrounds

  // Semantic
  success:     '#15803D',
  successSoft: '#DCFCE7',
  warning:     '#B45309',
  warningSoft: '#FEF3C7',
  danger:      '#B91C1C',
  dangerSoft:  '#FEE2E2',
  info:        '#0369A1',
  infoSoft:    '#E0F2FE',

  // Borders / dividers
  borderSubtle: '#E2E8F0',
  borderStrong: '#CBD5E1',
} as const;

/**
 * Parallel palette used by admin-only screens (Shelter Dashboard, Buildings
 * Dashboard). The dark surface is a deliberate signal — "you're in admin
 * land, this is not what end users see." Brand blue stays the same, but
 * text / surfaces / borders all flip to a slate-900 family.
 *
 * Components that need to support both palettes accept a `dark` boolean
 * prop and pick between `Palette` and `DarkPalette` at render time.
 */
export const DarkPalette = {
  // Surfaces
  bg:           '#0F172A',
  bgSubtle:     '#1E293B',
  card:         '#1E293B',
  overlay:      'rgba(2, 6, 23, 0.7)',

  // Text
  textPrimary:   '#F8FAFC',
  textSecondary: '#CBD5E1',
  textTertiary:  '#64748B',
  textInverse:   '#0F172A',

  // Brand — same blue, lighter soft tint for highlight against the dark bg
  brand:        '#60A5FA',
  brandPressed: '#3B82F6',
  brandSoft:    '#1E3A8A',
  brandOn:      '#0F172A',

  // Semantic
  success:     '#4ADE80',
  successSoft: '#14532D',
  warning:     '#FBBF24',
  warningSoft: '#78350F',
  danger:      '#F87171',
  dangerSoft:  '#7F1D1D',
  info:        '#38BDF8',
  infoSoft:    '#0C4A6E',

  // Borders / dividers
  borderSubtle: '#334155',
  borderStrong: '#475569',
} as const;

export const Spacing = {
  xs:  4,
  sm:  8,
  md:  12,
  lg:  16,
  xl:  24,
  xxl: 32,
  xxxl: 40,
} as const;

export const Radius = {
  sm:   6,
  md:   10,
  lg:   14,
  xl:   20,
  pill: 999,
} as const;

export const Typography = {
  // [fontSize, lineHeight, weight]
  title:       { fontSize: 24, lineHeight: 32, fontWeight: '700' as const },
  heading:     { fontSize: 18, lineHeight: 24, fontWeight: '700' as const },
  subheading:  { fontSize: 16, lineHeight: 22, fontWeight: '600' as const },
  body:        { fontSize: 15, lineHeight: 22, fontWeight: '400' as const },
  bodyStrong:  { fontSize: 15, lineHeight: 22, fontWeight: '600' as const },
  caption:     { fontSize: 13, lineHeight: 18, fontWeight: '400' as const },
  small:       { fontSize: 12, lineHeight: 16, fontWeight: '500' as const },
  // Section-label "ALL CAPS" used above grouped controls
  sectionLabel:{ fontSize: 12, lineHeight: 16, fontWeight: '700' as const,
                 letterSpacing: 1.2, textTransform: 'uppercase' as const },
} as const;

// React Native shadow + Android elevation paired so cards lift the same way
// on both platforms. Use `Shadow.sm` for inputs/rows, `Shadow.md` for cards.
export const Shadow = {
  sm: {
    shadowColor:   '#0F172A',
    shadowOpacity: 0.05,
    shadowOffset:  { width: 0, height: 1 },
    shadowRadius:  2,
    elevation:     1,
  },
  md: {
    shadowColor:   '#0F172A',
    shadowOpacity: 0.08,
    shadowOffset:  { width: 0, height: 2 },
    shadowRadius:  6,
    elevation:     3,
  },
} as const;

export const Theme = {
  palette: Palette,
  spacing: Spacing,
  radius:  Radius,
  type:    Typography,
  shadow:  Shadow,
} as const;

// ─── Expo starter scaffolding (kept untouched) ──────────────────────────────

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
