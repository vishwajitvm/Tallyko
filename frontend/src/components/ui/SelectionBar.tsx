/**
 * Bar shown while rows are selected (docs/20_High_Volume_UX.md §1.1, §5): count, Clear, the top
 * actions as buttons and the rest in an ActionMenu. Fixed height, one row, never wraps — except when
 * `minVisible` keeps more buttons than one narrow row can hold: then the buttons get a full-width row of
 * their own under the count (full labels, 44 px targets), as in the POS cart.
 * Place it directly above the list footer (DataList has a `selectionBar` slot for this).
 */
import React, { useState } from 'react';
import { LayoutChangeEvent, Platform, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme/ThemeProvider';
import { Text } from './Text';
import { Button, IconButton, type ButtonVariant } from './Button';
import { ActionMenu, type ActionMenuItem } from './ActionMenu';
import { visibleActionCount } from './listLogic';

type IconName = keyof typeof Ionicons.glyphMap;

export interface SelectionAction {
  key: string;
  label: string;
  icon?: IconName;
  onPress: () => void;
  /** Defaults: first action `primary`, others `outline`; `danger` actions use `dangerOutline`. */
  variant?: ButtonVariant;
  danger?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  loading?: boolean;
  shortcut?: string;
  description?: string;
}

export interface SelectionBarProps {
  count: number;
  onClear: () => void;
  actions?: SelectionAction[];
  /** Cap on buttons shown before overflowing into "More" (default 4, also limited by width). */
  maxVisible?: number;
  /** Keep at least this many actions as buttons even in narrow panels (e.g. 3 in the POS cart); labels shrink to icons. */
  minVisible?: number;
  /** Custom count label, default "3 selected". */
  label?: (count: number) => string;
  /** Offer "Select all N" when only some rows are selected. */
  total?: number;
  onSelectAll?: () => void;
  /** Web: stick to the bottom of the scrolling parent. */
  sticky?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function SelectionBar({ count, onClear, actions = [], maxVisible = 4, minVisible = 1, label, total, onSelectAll, sticky, style }: SelectionBarProps) {
  const { colors, radius } = useTheme();
  const [width, setWidth] = useState(0);
  if (count <= 0) return null;

  const compact = width > 0 && width < 560;
  const n = width ? visibleActionCount(width, actions.length, maxVisible, minVisible) : Math.min(actions.length, Math.max(1, minVisible));
  // More buttons than the width allows (forced by minVisible): stack them on a second row instead of squeezing labels
  const stacked = compact && n > 1 && n > visibleActionCount(width, actions.length, maxVisible, 1);
  const shown = actions.slice(0, n);
  const overflow = actions.slice(n);
  const text = label ? label(count) : compact ? `${count}` : `${count} selected`;
  const canSelectAll = !!onSelectAll && total !== undefined && count < total && !compact;

  const menuItems: ActionMenuItem[] = overflow.map((a) => ({
    key: a.key, label: a.label, icon: a.icon, onPress: a.onPress, danger: a.danger || a.variant === 'danger' || a.variant === 'dangerOutline',
    disabled: a.disabled || a.loading, disabledReason: a.disabledReason, shortcut: a.shortcut, description: a.description,
  }));

  const moreMenu = overflow.length ? (
    <ActionMenu
      items={menuItems}
      title="More actions"
      align="end"
      placement="top"
      trigger={(open) => (
        <Button icon="ellipsis-horizontal" variant="outline" size={compact && !stacked ? 'sm' : 'md'} accessibilityLabel="More actions" onPress={open} />
      )}
    />
  ) : null;
  const button = (a: SelectionAction, i: number) => (
    <Button
      key={a.key}
      title={a.label}
      icon={a.icon}
      size={compact && !stacked ? 'sm' : 'md'}
      variant={a.variant ?? (a.danger ? 'dangerOutline' : i === 0 ? 'primary' : 'outline')}
      onPress={a.onPress}
      disabled={a.disabled}
      disabledReason={a.disabledReason}
      loading={a.loading}
      shortcut={compact ? undefined : a.shortcut}
      style={stacked ? styles.stackedAction : styles.action}
    />
  );

  if (stacked) {
    return (
      <View
        onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
        accessibilityRole="toolbar"
        accessibilityLabel={`${count} selected`}
        style={[styles.stack, { backgroundColor: colors.primarySoft, borderColor: colors.primary, borderRadius: radius.md }, style]}
      >
        <View style={styles.stackRow}>
          <IconButton icon="close" accessibilityLabel="Clear selection" onPress={onClear} size="sm" />
          <View style={styles.count}>
            <Text variant="bodyStrong" color={colors.primarySoftText} numberOfLines={1} style={styles.tabular}>{text}</Text>
          </View>
          {moreMenu}
        </View>
        <View style={styles.stackRow}>{shown.map(button)}</View>
      </View>
    );
  }

  return (
    <View
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
      accessibilityRole="toolbar"
      accessibilityLabel={`${count} selected`}
      style={[
        styles.bar,
        {
          height: compact ? 52 : 56,
          paddingHorizontal: compact ? 6 : 10,
          backgroundColor: colors.primarySoft,
          borderColor: colors.primary,
          borderRadius: radius.md,
        },
        sticky && Platform.OS === 'web' && ({ position: 'sticky', bottom: 0, zIndex: 5 } as any),
        style,
      ]}
    >
      <IconButton icon="close" accessibilityLabel="Clear selection" onPress={onClear} size={compact ? 'sm' : 'md'} />
      <View style={styles.count}>
        <Text variant={compact ? 'bodyStrong' : 'bodyStrong'} color={colors.primarySoftText} numberOfLines={1} style={styles.tabular}>
          {text}
        </Text>
        {canSelectAll ? (
          <Button title={`Select all ${total}`} variant="ghost" size="sm" onPress={onSelectAll} />
        ) : null}
      </View>
      <View style={styles.actions}>
        {shown.map(button)}
        {moreMenu}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, overflow: 'hidden' },
  count: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1, minWidth: 0, marginRight: 'auto' },
  tabular: { fontVariant: ['tabular-nums'] },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1, minWidth: 0, justifyContent: 'flex-end' },
  action: { flexShrink: 1, minWidth: 0 },
  stack: { borderWidth: 1, padding: 6, gap: 6 },
  stackRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stackedAction: { flex: 1, minWidth: 0, paddingHorizontal: 8 },
});
