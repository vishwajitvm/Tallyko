/**
 * Small UI pieces shared by the live floor screens: age chip with colour escalation, live/offline indicator,
 * waiter avatar and the right-click hook for web.
 */
import React, { useEffect } from 'react';
import { Platform, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme/ThemeProvider';
import type { ThemeColors } from '@/theme/tokens';
import { Text } from '@/components/ui';
import { formatAge, type AgeTone } from './floorLogic';

export function ageColors(colors: ThemeColors, tone: AgeTone): { bg: string; fg: string; solid: string } {
  if (tone === 'late') return { bg: colors.dangerSoft, fg: colors.dangerText, solid: colors.danger };
  if (tone === 'warn') return { bg: colors.kitchenSoft, fg: colors.kitchenText, solid: colors.kitchen };
  return { bg: colors.neutralSoft, fg: colors.textMuted, solid: colors.borderStrong };
}

/** "⏱ 42 min" — neutral, then amber, then red. */
export function AgeChip({ minutes, tone, size = 'sm', label, style }: {
  minutes: number; tone: AgeTone; size?: 'sm' | 'md' | 'lg'; label?: string; style?: StyleProp<ViewStyle>;
}) {
  const { colors, radius } = useTheme();
  const c = ageColors(colors, tone);
  const h = size === 'lg' ? 34 : size === 'md' ? 28 : 22;
  return (
    <View accessibilityLabel={`${label ?? formatAge(minutes)}${tone === 'late' ? ', running late' : tone === 'warn' ? ', getting late' : ''}`}
      style={[styles.age, { height: h, paddingHorizontal: size === 'sm' ? 7 : 10, borderRadius: radius.pill, backgroundColor: c.bg }, style]}>
      <Ionicons name={tone === 'late' ? 'alert-circle' : 'time-outline'} size={size === 'lg' ? 18 : size === 'md' ? 15 : 13} color={c.fg} />
      <Text variant={size === 'lg' ? 'h3' : size === 'md' ? 'smallStrong' : 'caption'} color={c.fg} numberOfLines={1} style={styles.num}>
        {label ?? formatAge(minutes)}
      </Text>
    </View>
  );
}

/** Green dot "Live · 12:04:10", amber while reconnecting, red when offline with data from earlier. */
export function LiveStatus({ updatedAt, error, paused, intervalLabel }: { updatedAt: number | null; error: string | null; paused?: boolean; intervalLabel?: string }) {
  const { colors } = useTheme();
  const time = updatedAt ? new Date(updatedAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', second: '2-digit' }) : null;
  const tone = error ? colors.danger : paused ? colors.textSubtle : colors.success;
  const text = error
    ? `Can't reach the server${time ? ` · showing ${time}` : ''} · retrying`
    : paused ? 'Paused while hidden' : `Live${intervalLabel ? ` · every ${intervalLabel}` : ''}${time ? ` · ${time}` : ''}`;
  return (
    <View style={styles.live} accessibilityLiveRegion="polite">
      <View style={[styles.dot, { backgroundColor: tone }]} />
      <Text variant="caption" color={error ? colors.dangerText : colors.textSubtle} numberOfLines={1}>{text}</Text>
    </View>
  );
}

/** Round initials badge for the waiter on a table or bill. */
export function WaiterAvatar({ initials, name, size = 22 }: { initials: string; name?: string | null; size?: number }) {
  const { colors } = useTheme();
  if (!initials) return null;
  return (
    <View accessibilityLabel={`Waiter ${name ?? initials}`}
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' }}>
      <Text variant="caption" color={colors.text} style={{ fontSize: size * 0.45, lineHeight: size * 0.6, letterSpacing: 0 }}>{initials}</Text>
    </View>
  );
}

/** Right-click on web opens the same menu as long-press (no-op on native). */
export function useContextMenu(ref: React.RefObject<View | null>, onMenu: (() => void) | undefined) {
  useEffect(() => {
    if (Platform.OS !== 'web' || !onMenu) return undefined;
    const node = ref.current as unknown as HTMLElement | null;
    if (!node?.addEventListener) return undefined;
    const handler = (e: MouseEvent) => { e.preventDefault(); onMenu(); };
    node.addEventListener('contextmenu', handler);
    return () => node.removeEventListener('contextmenu', handler);
  }, [ref, onMenu]);
}

/** Section heading inside a long scrolling page. */
export function GroupTitle({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <View style={styles.group}>
      <Text variant="caption" tone="subtle" style={{ textTransform: 'uppercase', flex: 1 }} numberOfLines={1}>{title}</Text>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  age: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },
  num: { fontVariant: ['tabular-nums'] },
  live: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 20 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  group: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 28, marginTop: 4 },
});
