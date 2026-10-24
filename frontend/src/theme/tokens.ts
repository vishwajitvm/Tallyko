/**
 * Tallyko design tokens. Every screen reads colours, spacing, radii and type from here,
 * so the brand can be re-skinned by editing this one file.
 */
export const palette = {
  teal50: '#ECFDF9', teal100: '#CCFBEF', teal500: '#14B8A6', teal600: '#0D9488', teal700: '#0F766E', teal800: '#115E59', teal900: '#134E4A',
  amber50: '#FFFBEB', amber100: '#FEF3C7', amber300: '#FCD34D', amber400: '#FBBF24', amber500: '#F59E0B', amber600: '#D97706', amber700: '#B45309',
  red50: '#FEF2F2', red100: '#FEE2E2', red500: '#EF4444', red600: '#DC2626', red700: '#B91C1C',
  green50: '#F0FDF4', green100: '#DCFCE7', green500: '#22C55E', green600: '#16A34A', green700: '#15803D',
  blue50: '#EFF6FF', blue100: '#DBEAFE', blue500: '#3B82F6', blue600: '#2563EB', blue700: '#1D4ED8',
  violet50: '#F5F3FF', violet100: '#EDE9FE', violet300: '#C4B5FD', violet500: '#8B5CF6', violet600: '#7C3AED', violet700: '#6D28D9',
  amberInk: '#1F1300', white: '#FFFFFF',
  slate0: '#FFFFFF', slate25: '#FBFCFD', slate50: '#F6F8FA', slate100: '#EEF1F5', slate200: '#E2E7EE', slate300: '#CBD3DE',
  slate400: '#94A1B3', slate500: '#64748B', slate600: '#475569', slate700: '#334155', slate800: '#1E293B', slate850: '#172131',
  slate900: '#0F172A', slate950: '#0A101C',
};

export interface ThemeColors {
  background: string; surface: string; surfaceAlt: string; surfaceSunken: string; overlay: string;
  border: string; borderStrong: string; divider: string;
  text: string; textMuted: string; textSubtle: string; textInverse: string;
  primary: string; primaryHover: string; primaryText: string; primarySoft: string; primarySoftText: string;
  accent: string; accentSoft: string; accentText: string;
  success: string; successSoft: string; successText: string;
  warning: string; warningSoft: string; warningText: string;
  danger: string; dangerSoft: string; dangerText: string;
  info: string; infoSoft: string; infoText: string;
  veg: string; nonVeg: string;
  sidebar: string; sidebarText: string; sidebarMuted: string; sidebarActive: string; sidebarActiveText: string;
  focus: string; shadow: string;
  /** Text/icon colour on solid success, danger and accent fills. */
  onSuccess: string; onDanger: string; onAccent: string;
  /** Kitchen / KOT actions: solid amber with dark, readable text (never confused with Pay = green). */
  kitchen: string; kitchenHover: string; onKitchen: string; kitchenSoft: string; kitchenText: string;
  /** "Waiting for confirmation" (UPI claim, online order awaiting accept): purple. */
  waiting: string; waitingSoft: string; waitingText: string;
  /** Disabled controls: clearly reduced contrast, never mistaken for an enabled button. */
  disabledBg: string; disabledText: string; disabledBorder: string;
  /** Skeleton placeholder blocks and selected-row tint. */
  skeleton: string; selectedRow: string;
  /** Neutral status/pill fill that stays visible on `surface` in both themes. */
  neutralSoft: string;
  /** Count bubble on buttons (e.g. "Send 2"). */
  bubble: string; onBubble: string;
}

export const lightColors: ThemeColors = {
  background: palette.slate50, surface: palette.slate0, surfaceAlt: palette.slate25, surfaceSunken: palette.slate100,
  overlay: 'rgba(15, 23, 42, 0.45)',
  border: palette.slate200, borderStrong: palette.slate300, divider: palette.slate100,
  text: palette.slate900, textMuted: palette.slate600, textSubtle: palette.slate400, textInverse: palette.slate0,
  primary: palette.teal700, primaryHover: palette.teal800, primaryText: palette.slate0, primarySoft: palette.teal50, primarySoftText: palette.teal800,
  accent: palette.amber500, accentSoft: palette.amber50, accentText: palette.amber700,
  success: palette.green600, successSoft: palette.green50, successText: palette.green700,
  warning: palette.amber600, warningSoft: palette.amber50, warningText: palette.amber700,
  danger: palette.red600, dangerSoft: palette.red50, dangerText: palette.red700,
  info: palette.blue600, infoSoft: palette.blue50, infoText: palette.blue700,
  veg: palette.green600, nonVeg: palette.red600,
  sidebar: palette.slate900, sidebarText: '#E2E8F0', sidebarMuted: palette.slate400, sidebarActive: 'rgba(20, 184, 166, 0.16)', sidebarActiveText: '#5EEAD4',
  focus: palette.teal500, shadow: '#0F172A',
  onSuccess: palette.white, onDanger: palette.white, onAccent: palette.amberInk,
  kitchen: palette.amber500, kitchenHover: palette.amber600, onKitchen: palette.amberInk, kitchenSoft: palette.amber100, kitchenText: palette.amber700,
  waiting: palette.violet600, waitingSoft: palette.violet50, waitingText: palette.violet700,
  disabledBg: palette.slate100, disabledText: palette.slate400, disabledBorder: palette.slate200,
  skeleton: palette.slate100, selectedRow: palette.teal50, neutralSoft: palette.slate100,
  bubble: palette.red600, onBubble: palette.white,
};

export const darkColors: ThemeColors = {
  background: palette.slate950, surface: palette.slate900, surfaceAlt: palette.slate850, surfaceSunken: '#0C1424',
  overlay: 'rgba(0, 0, 0, 0.6)',
  border: '#243247', borderStrong: '#33445E', divider: '#1A2638',
  text: '#F1F5F9', textMuted: '#A3B1C6', textSubtle: '#6B7A90', textInverse: palette.slate900,
  primary: palette.teal500, primaryHover: '#2DD4BF', primaryText: '#042F2E', primarySoft: 'rgba(20, 184, 166, 0.14)', primarySoftText: '#5EEAD4',
  accent: palette.amber500, accentSoft: 'rgba(245, 158, 11, 0.14)', accentText: '#FCD34D',
  success: palette.green500, successSoft: 'rgba(34, 197, 94, 0.14)', successText: '#86EFAC',
  warning: palette.amber500, warningSoft: 'rgba(245, 158, 11, 0.14)', warningText: '#FCD34D',
  danger: palette.red500, dangerSoft: 'rgba(239, 68, 68, 0.14)', dangerText: '#FCA5A5',
  info: palette.blue500, infoSoft: 'rgba(59, 130, 246, 0.14)', infoText: '#93C5FD',
  veg: palette.green500, nonVeg: palette.red500,
  sidebar: '#070C16', sidebarText: '#E2E8F0', sidebarMuted: palette.slate500, sidebarActive: 'rgba(20, 184, 166, 0.18)', sidebarActiveText: '#5EEAD4',
  focus: palette.teal500, shadow: '#000000',
  onSuccess: '#052E16', onDanger: palette.white, onAccent: palette.amberInk,
  kitchen: palette.amber500, kitchenHover: palette.amber400, onKitchen: palette.amberInk, kitchenSoft: 'rgba(245, 158, 11, 0.16)', kitchenText: palette.amber300,
  waiting: palette.violet500, waitingSoft: 'rgba(139, 92, 246, 0.16)', waitingText: palette.violet300,
  disabledBg: '#1A2638', disabledText: '#5B6A80', disabledBorder: '#243247',
  skeleton: '#1A2638', selectedRow: 'rgba(20, 184, 166, 0.12)', neutralSoft: palette.slate800,
  bubble: palette.red500, onBubble: palette.white,
};

export const space = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32, huge: 48 } as const;
export const radius = { sm: 6, md: 10, lg: 14, xl: 18, xxl: 24, pill: 999 } as const;

export const fonts = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  extrabold: 'Inter_800ExtraBold',
} as const;

export const type = {
  display: { fontSize: 30, lineHeight: 38, fontFamily: fonts.bold, letterSpacing: -0.6 },
  h1: { fontSize: 24, lineHeight: 32, fontFamily: fonts.bold, letterSpacing: -0.4 },
  h2: { fontSize: 19, lineHeight: 26, fontFamily: fonts.semibold, letterSpacing: -0.2 },
  h3: { fontSize: 16, lineHeight: 22, fontFamily: fonts.semibold },
  body: { fontSize: 15, lineHeight: 22, fontFamily: fonts.regular },
  bodyStrong: { fontSize: 15, lineHeight: 22, fontFamily: fonts.semibold },
  small: { fontSize: 13, lineHeight: 18, fontFamily: fonts.regular },
  smallStrong: { fontSize: 13, lineHeight: 18, fontFamily: fonts.semibold },
  caption: { fontSize: 11.5, lineHeight: 16, fontFamily: fonts.medium, letterSpacing: 0.3 },
  money: { fontSize: 15, lineHeight: 22, fontFamily: fonts.semibold, fontVariant: ['tabular-nums'] as ('tabular-nums')[] },
  moneyLarge: { fontSize: 28, lineHeight: 34, fontFamily: fonts.bold, letterSpacing: -0.5, fontVariant: ['tabular-nums'] as ('tabular-nums')[] },
} as const;

export type TypeVariant = keyof typeof type;

/** Layout breakpoints (dp). Tablet and desktop get a sidebar and split panes. */
export const breakpoints = { tablet: 768, desktop: 1100 } as const;

/** Minimum touch target for busy counters (WCAG + Material recommend ≥44–48). */
export const touch = { min: 44, comfortable: 52 } as const;

/** Fixed list row heights (§2.6): compact for desktop tables, comfortable for touch. */
export const rowHeight = { compact: 44, comfortable: 56 } as const;
