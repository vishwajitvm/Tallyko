/** Shared pieces for the Staff & roles screen tabs. */
import React from 'react';
import { Platform, Pressable, ScrollView, StyleProp, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { AccessInfo } from '@/api/types';
import type { RoleDef } from '@/api/access';
import { Badge, Segmented, Text, type BadgeTone } from '@/components/ui';
import { dayRange } from '@/lib/format';
import { useLayout, useTheme } from '@/theme/ThemeProvider';

type IconName = keyof typeof Ionicons.glyphMap;

/** Everything the tabs need to know about who is looking. */
export interface StaffCtx {
  access: AccessInfo | null;
  /** Role key of the signed-in person (from /access/me, else the login session) */
  myRole: string | null;
  myStaffId: string | null;
  myEmail: string;
  isOwner: boolean;
  canManageStaff: boolean;
  hasFeature: (feature: string) => boolean;
  can: (permission: string) => boolean;
  roles: RoleDef[] | null;
  rolesError: string | null;
  reloadRoles: () => void;
  setRoles: (update: (list: RoleDef[] | null) => RoleDef[] | null) => void;
}

const BUILT_IN: Record<string, { tone: BadgeTone; icon: IconName }> = {
  owner: { tone: 'accent', icon: 'key-outline' },
  manager: { tone: 'primary', icon: 'briefcase-outline' },
  cashier: { tone: 'info', icon: 'cash-outline' },
  waiter: { tone: 'neutral', icon: 'restaurant-outline' },
  kitchen: { tone: 'warning', icon: 'flame-outline' },
};

export function roleTone(key: string): BadgeTone {
  return BUILT_IN[key]?.tone ?? 'success';
}

export function roleIcon(key: string): IconName {
  return BUILT_IN[key]?.icon ?? 'shield-half-outline';
}

/** Readable role name: from the roles list, else the built-in fallback, else the key. */
export function roleName(key: string | null | undefined, roles: RoleDef[] | null, fallback?: string): string {
  if (!key) return fallback ?? 'Former staff';
  const found = roles?.find((r) => r.key === key);
  if (found) return found.name;
  if (fallback) return fallback;
  return key.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

export function RoleBadge({ roleKey, label, muted }: { roleKey: string; label: string; muted?: boolean }) {
  return <Badge label={label} tone={muted ? 'neutral' : roleTone(roleKey)} icon={roleIcon(roleKey)} />;
}

/** Mirrors backend `_can_manage`: only owners manage owners/managers; managers handle everyone else. */
export const PRIVILEGED_ROLES = ['owner', 'manager'];
export function canManageRole(isOwner: boolean, canManageStaff: boolean, target: string): boolean {
  if (!canManageStaff) return false;
  return isOwner || !PRIVILEGED_ROLES.includes(target);
}

import { initials } from '@/lib/initials';
export { initials };

export function Avatar({ name, active = true, size = 40 }: { name: string; active?: boolean; size?: number }) {
  const { colors } = useTheme();
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: active ? colors.primarySoft : colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}>
      <Text variant={size >= 40 ? 'smallStrong' : 'caption'} color={active ? colors.primarySoftText : colors.textSubtle}>{initials(name)}</Text>
    </View>
  );
}

// --- Date ranges ---------------------------------------------------------------------------------------------

export type RangeKey = 'today' | '7d' | '30d';
export const RANGE_OPTIONS: { value: RangeKey; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
];
const RANGE_DAYS: Record<RangeKey, number> = { today: 1, '7d': 7, '30d': 30 };

/** Local calendar days ending today, as ISO strings with the device's offset. */
export function localRange(range: RangeKey): { from: string; to: string } {
  const days = RANGE_DAYS[range];
  const start = new Date();
  start.setDate(start.getDate() - (days - 1));
  return dayRange(start, days);
}

/** Same window as UTC ISO strings (for endpoints that ignore offsets). */
export function utcRange(range: RangeKey): { from: string; to: string } {
  const { from, to } = localRange(range);
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString() };
}

// --- Layout helpers ------------------------------------------------------------------------------------------

/** Summary on the left, actions on the right; wraps on phones. */
export function Toolbar({ left, right }: { left?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap', justifyContent: 'space-between' }}>
      <View style={{ flexGrow: 1, flexShrink: 1, minWidth: 180 }}>{left}</View>
      {right ? <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>{right}</View> : null}
    </View>
  );
}

/** Horizontally scrolling row of chips (filters) that bleeds to the screen edge on phones. */
export function ChipScroller({ children }: { children: React.ReactNode }) {
  const { isPhone } = useLayout();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={isPhone ? { marginHorizontal: -16 } : undefined}
      contentContainerStyle={{ gap: 8, paddingHorizontal: isPhone ? 16 : 0, alignItems: 'center' }}>
      {children}
    </ScrollView>
  );
}

export interface Column {
  key: string;
  label: string;
  /** flex grow; use `width` for fixed columns */
  flex?: number;
  width?: number;
  align?: 'left' | 'right' | 'center';
}

export function cellStyle(c: Column): StyleProp<ViewStyle> {
  return [
    c.width ? { width: c.width } : { flex: c.flex ?? 1, minWidth: 0 },
    { alignItems: c.align === 'right' ? 'flex-end' : c.align === 'center' ? 'center' : 'flex-start' },
  ];
}

export function TableHead({ columns }: { columns: Column[] }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: colors.surfaceAlt, borderBottomWidth: 1, borderBottomColor: colors.border }}>
      {columns.map((c) => (
        <View key={c.key} style={cellStyle(c)}>
          <Text variant="caption" tone="subtle" style={{ textTransform: 'uppercase' }} numberOfLines={1}>{c.label}</Text>
        </View>
      ))}
    </View>
  );
}

/** Pressable table/list row with hover + divider. */
export function Row({ children, onPress, first, style, accessibilityLabel, disabled }: {
  children: React.ReactNode; onPress?: () => void; first?: boolean; style?: StyleProp<ViewStyle>; accessibilityLabel?: string; disabled?: boolean;
}) {
  const { colors } = useTheme();
  const interactive = !!onPress && !disabled;
  return (
    <Pressable
      onPress={interactive ? onPress : undefined}
      disabled={!interactive}
      accessibilityRole={interactive ? 'button' : undefined}
      accessibilityLabel={accessibilityLabel}
      style={({ hovered, pressed }: any) => [
        { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, minHeight: 60, borderTopWidth: first ? 0 : 1, borderTopColor: colors.divider },
        interactive && (hovered || pressed) ? { backgroundColor: colors.surfaceSunken } : null,
        Platform.OS === 'web' && interactive ? ({ cursor: 'pointer' } as any) : null,
        style,
      ]}
    >
      {children}
    </Pressable>
  );
}

/** Checkbox row used in the permission matrix and table picker. */
export function CheckRow({ checked, onToggle, title, subtitle, disabled, right }: {
  checked: boolean; onToggle?: () => void; title: string; subtitle?: string; disabled?: boolean; right?: React.ReactNode;
}) {
  const { colors, radius } = useTheme();
  const interactive = !!onToggle && !disabled;
  return (
    <Pressable
      onPress={interactive ? onToggle : undefined}
      disabled={!interactive}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled: !interactive }}
      accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title}
      style={({ hovered }: any) => [
        { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 12, minHeight: 48, borderRadius: radius.md },
        interactive && hovered ? { backgroundColor: colors.surfaceSunken } : null,
        Platform.OS === 'web' && interactive ? ({ cursor: 'pointer' } as any) : null,
      ]}
    >
      <View style={{
        width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center',
        borderColor: checked ? (disabled ? colors.borderStrong : colors.primary) : colors.borderStrong,
        backgroundColor: checked ? (disabled ? colors.borderStrong : colors.primary) : 'transparent',
      }}>
        {checked ? <Ionicons name="checkmark" size={15} color={colors.primaryText} /> : null}
      </View>
      <View style={{ flex: 1, minWidth: 0, opacity: disabled && !checked ? 0.7 : 1 }}>
        <Text variant="bodyStrong" tone={disabled ? 'muted' : 'default'}>{title}</Text>
        {subtitle ? <Text variant="small" tone="subtle">{subtitle}</Text> : null}
      </View>
      {right}
    </Pressable>
  );
}

/** Tab picker: segmented control on tablets/desktops, scrolling chips on phones. */
export function TabBar<T extends string>({ value, options, onChange }: {
  value: T; options: { value: T; label: string; icon?: IconName }[]; onChange: (v: T) => void;
}) {
  const { isPhone } = useLayout();
  const { colors } = useTheme();
  if (!isPhone) {
    return <View style={{ maxWidth: 720 }}><Segmented value={value} options={options} onChange={onChange} /></View>;
  }
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -16, flexGrow: 0, flexShrink: 0 }}
      contentContainerStyle={{ gap: 6, paddingHorizontal: 16, alignItems: 'center' }} accessibilityRole="tablist">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable key={o.value} onPress={() => onChange(o.value)} accessibilityRole="tab" accessibilityState={{ selected: active }}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, minHeight: 40, borderRadius: 20,
              backgroundColor: active ? colors.primary : colors.surface, borderWidth: 1, borderColor: active ? colors.primary : colors.border,
            }}>
            {o.icon ? <Ionicons name={o.icon} size={16} color={active ? colors.primaryText : colors.textMuted} /> : null}
            <Text variant="smallStrong" color={active ? colors.primaryText : colors.text}>{o.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
