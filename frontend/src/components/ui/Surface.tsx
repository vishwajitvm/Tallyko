import React from 'react';
import { ActivityIndicator, Pressable, StyleProp, StyleSheet, View, ViewStyle, Platform, Switch as RNSwitch } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme/ThemeProvider';
import { palette } from '@/theme/tokens';
import { Text, type TextTone } from './Text';
import { Button } from './Button';

type IconName = keyof typeof Ionicons.glyphMap;

export function Card({ children, style, padded = true, onPress, elevated = false }: {
  children: React.ReactNode; style?: StyleProp<ViewStyle>; padded?: boolean; onPress?: () => void; elevated?: boolean;
}) {
  const { colors, radius, shadow } = useTheme();
  const base = [
    { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.lg },
    padded && { padding: 16 },
    elevated && shadow(1),
  ];
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        style={({ pressed, hovered }: any) => [
          ...base,
          (pressed || hovered) && { borderColor: colors.borderStrong, backgroundColor: colors.surfaceAlt },
          Platform.OS === 'web' && ({ cursor: 'pointer' } as any),
          style,
        ]}
      >
        {children}
      </Pressable>
    );
  }
  return <View style={[...base, style]}>{children}</View>;
}

export type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'accent';

export function Badge({ label, tone = 'neutral', icon, style }: { label: string; tone?: BadgeTone; icon?: IconName; style?: StyleProp<ViewStyle> }) {
  const { colors, radius } = useTheme();
  const map: Record<BadgeTone, [string, string]> = {
    neutral: [colors.surfaceSunken, colors.textMuted],
    primary: [colors.primarySoft, colors.primarySoftText],
    success: [colors.successSoft, colors.successText],
    warning: [colors.warningSoft, colors.warningText],
    danger: [colors.dangerSoft, colors.dangerText],
    info: [colors.infoSoft, colors.infoText],
    accent: [colors.accentSoft, colors.accentText],
  };
  const [bg, fg] = map[tone];
  return (
    <View style={[styles.badge, { backgroundColor: bg, borderRadius: radius.pill }, style]}>
      {icon ? <Ionicons name={icon} size={12} color={fg} /> : null}
      <Text variant="caption" color={fg} numberOfLines={1}>{label}</Text>
    </View>
  );
}

export function Chip({ label, selected, onPress, icon, count }: { label: string; selected?: boolean; onPress?: () => void; icon?: IconName; count?: number | string }) {
  const { colors, radius } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      style={({ hovered }: any) => [
        styles.chip,
        {
          borderRadius: radius.pill,
          backgroundColor: selected ? colors.text : hovered ? colors.surfaceSunken : colors.surface,
          borderColor: selected ? colors.text : colors.border,
        },
        Platform.OS === 'web' && ({ cursor: 'pointer' } as any),
      ]}
    >
      {icon ? <Ionicons name={icon} size={15} color={selected ? colors.surface : colors.textMuted} /> : null}
      <Text variant="smallStrong" color={selected ? colors.surface : colors.text} numberOfLines={1}>{label}</Text>
      {count !== undefined ? <Text variant="caption" color={selected ? colors.surface : colors.textSubtle}>{count}</Text> : null}
    </Pressable>
  );
}

export function Segmented<T extends string>({ value, options, onChange, size = 'md' }: {
  value: T; options: { value: T; label: string; icon?: IconName }[]; onChange: (v: T) => void; size?: 'sm' | 'md';
}) {
  const { colors, radius } = useTheme();
  return (
    <View style={[styles.segmented, { backgroundColor: colors.surfaceSunken, borderRadius: radius.md }]} accessibilityRole="tablist">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(o.value)}
            style={[
              styles.segment,
              { minHeight: size === 'sm' ? 32 : 40, borderRadius: radius.sm, backgroundColor: active ? colors.surface : 'transparent' },
              active && { borderColor: colors.border, borderWidth: 1 },
              Platform.OS === 'web' && ({ cursor: 'pointer' } as any),
            ]}
          >
            {o.icon ? <Ionicons name={o.icon} size={16} color={active ? colors.text : colors.textMuted} /> : null}
            <Text variant="smallStrong" color={active ? colors.text : colors.textMuted} numberOfLines={1}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  return <View style={[{ height: StyleSheet.hairlineWidth * 2, backgroundColor: colors.divider }, style]} />;
}

export function EmptyState({ icon = 'file-tray-outline', title, message, action }: {
  icon?: IconName; title: string; message?: string; action?: { label: string; onPress: () => void; icon?: IconName };
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.empty}>
      <View style={[styles.emptyIcon, { backgroundColor: colors.surfaceSunken }]}>
        <Ionicons name={icon} size={28} color={colors.textSubtle} />
      </View>
      <Text variant="h3" align="center">{title}</Text>
      {message ? <Text tone="muted" align="center" style={{ maxWidth: 360 }}>{message}</Text> : null}
      {action ? <Button title={action.label} icon={action.icon} onPress={action.onPress} style={{ marginTop: 8 }} /> : null}
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <EmptyState icon="cloud-offline-outline" title="Couldn't load this" message={message}
      action={onRetry ? { label: 'Try again', onPress: onRetry, icon: 'refresh' } : undefined} />
  );
}

export function Loading({ label }: { label?: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.empty}>
      <ActivityIndicator color={colors.primary} />
      {label ? <Text tone="muted">{label}</Text> : null}
    </View>
  );
}

export function Stat({ label, value, hint, icon, tone = 'default' }: { label: string; value: string; hint?: string; icon?: IconName; tone?: TextTone }) {
  const { colors } = useTheme();
  return (
    <Card style={{ flex: 1, minWidth: 150, gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {icon ? <Ionicons name={icon} size={16} color={colors.textSubtle} /> : null}
        <Text variant="small" tone="muted" numberOfLines={1}>{label}</Text>
      </View>
      <Text variant="h1" tone={tone} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      {hint ? <Text variant="small" tone="subtle" numberOfLines={1}>{hint}</Text> : null}
    </Card>
  );
}

export function ListRow({ title, subtitle, left, right, onPress, icon, danger }: {
  title: string; subtitle?: string; left?: React.ReactNode; right?: React.ReactNode; onPress?: () => void; icon?: IconName; danger?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      style={({ pressed, hovered }: any) => [
        styles.row,
        (pressed || hovered) && onPress ? { backgroundColor: colors.surfaceSunken } : null,
        Platform.OS === 'web' && onPress ? ({ cursor: 'pointer' } as any) : null,
      ]}
    >
      {icon ? (
        <View style={[styles.rowIcon, { backgroundColor: danger ? colors.dangerSoft : colors.surfaceSunken }]}>
          <Ionicons name={icon} size={18} color={danger ? colors.danger : colors.textMuted} />
        </View>
      ) : left}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="bodyStrong" tone={danger ? 'danger' : 'default'} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text variant="small" tone="muted" numberOfLines={2}>{subtitle}</Text> : null}
      </View>
      {right ?? (onPress ? <Ionicons name="chevron-forward" size={18} color={colors.textSubtle} /> : null)}
    </Pressable>
  );
}

export function SwitchRow({ title, subtitle, value, onValueChange, disabled }: {
  title: string; subtitle?: string; value: boolean; onValueChange: (v: boolean) => void; disabled?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text variant="bodyStrong">{title}</Text>
        {subtitle ? <Text variant="small" tone="muted">{subtitle}</Text> : null}
      </View>
      <RNSwitch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ true: colors.primary, false: colors.borderStrong }}
        thumbColor={palette.white}
        accessibilityLabel={title}
      />
    </View>
  );
}

export function VegMark({ veg, size = 14 }: { veg: boolean | null | undefined; size?: number }) {
  const { colors } = useTheme();
  if (veg === null || veg === undefined) return null;
  const color = veg ? colors.veg : colors.nonVeg;
  return (
    <View accessibilityLabel={veg ? 'Vegetarian' : 'Non-vegetarian'}
      style={{ width: size, height: size, borderWidth: 1.5, borderColor: color, borderRadius: 3, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: size * 0.45, height: size * 0.45, borderRadius: size, backgroundColor: color }} />
    </View>
  );
}

export function SectionTitle({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <View style={styles.sectionTitle}>
      <Text variant="caption" tone="subtle" style={{ textTransform: 'uppercase' }}>{title}</Text>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, minHeight: 36, borderWidth: 1 },
  segmented: { flexDirection: 'row', padding: 3, gap: 3 },
  segment: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 10 },
  empty: { alignItems: 'center', justifyContent: 'center', gap: 10, padding: 32, flexGrow: 1 },
  emptyIcon: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 12, minHeight: 56, borderRadius: 10 },
  rowIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, marginBottom: 4 },
});
