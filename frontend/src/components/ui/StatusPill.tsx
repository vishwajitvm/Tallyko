/**
 * One colour, icon and label per status, everywhere (docs/20_High_Volume_UX.md §4):
 * pending/new = amber, preparing = blue, ready = green, served/paid = neutral,
 * cancelled/void = red + struck through, waiting for confirmation (UPI claim) = purple.
 */
import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme/ThemeProvider';
import type { ThemeColors } from '@/theme/tokens';
import { Text } from './Text';
import { STATUS_META, statusMeta, type StatusMeta, type StatusTone, type KnownStatus } from './statusMeta';

export { STATUS_META, statusMeta, type StatusMeta, type StatusTone, type KnownStatus };
export type { KitchenStatus, OrderStatus, PaymentStatus, SubscriptionStatus } from './statusMeta';

export function statusToneColors(colors: ThemeColors, tone: StatusTone): { bg: string; fg: string; solid: string } {
  switch (tone) {
    case 'pending': return { bg: colors.kitchenSoft, fg: colors.kitchenText, solid: colors.kitchen };
    case 'progress': return { bg: colors.infoSoft, fg: colors.infoText, solid: colors.info };
    case 'ready': return { bg: colors.successSoft, fg: colors.successText, solid: colors.success };
    case 'void':
    case 'danger': return { bg: colors.dangerSoft, fg: colors.dangerText, solid: colors.danger };
    case 'waiting': return { bg: colors.waitingSoft, fg: colors.waitingText, solid: colors.waiting };
    case 'brand': return { bg: colors.primarySoft, fg: colors.primarySoftText, solid: colors.primary };
    case 'neutral':
    default: return { bg: colors.neutralSoft, fg: colors.textMuted, solid: colors.textSubtle };
  }
}

export function StatusPill({ status, label, size = 'sm', showIcon = true, style, count }: {
  status: KnownStatus | (string & {});
  /** Override the default label (e.g. "Ready · 3 min"). */
  label?: string;
  size?: 'sm' | 'md';
  showIcon?: boolean;
  /** Optional count after the label, e.g. Ready 4. */
  count?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors, radius } = useTheme();
  const meta = statusMeta(status);
  const { bg, fg } = statusToneColors(colors, meta.tone);
  const md = size === 'md';
  const text = label ?? meta.label;
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={`Status: ${text}${count !== undefined ? ` ${count}` : ''}`}
      style={[styles.pill, { backgroundColor: bg, borderRadius: radius.pill, height: md ? 28 : 22, paddingHorizontal: md ? 10 : 8 }, style]}
    >
      {showIcon ? <Ionicons name={meta.icon} size={md ? 14 : 12} color={fg} /> : null}
      <Text
        variant={md ? 'smallStrong' : 'caption'}
        color={fg}
        numberOfLines={1}
        style={[styles.label, meta.struck ? styles.struck : undefined]}
      >
        {text}
      </Text>
      {count !== undefined ? <Text variant={md ? 'smallStrong' : 'caption'} color={fg} style={styles.count}>{count}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', maxWidth: '100%', minWidth: 0 },
  label: { flexShrink: 1, minWidth: 0 },
  struck: { textDecorationLine: 'line-through' },
  count: { fontVariant: ['tabular-nums'], opacity: 0.85 },
});
