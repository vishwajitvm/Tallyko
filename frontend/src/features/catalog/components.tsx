/**
 * Small building blocks used only by the catalog/inventory screens (the shared UI kit has no
 * checkbox, labelled field group or collapsible card).
 */
import React, { useState } from 'react';
import { Platform, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, type Href } from 'expo-router';
import { useTheme } from '@/theme/ThemeProvider';
import { Card, Chip, EmptyState, Text } from '@/components/ui';

type IconName = keyof typeof Ionicons.glyphMap;

export function Checkbox({ checked, onChange, label, disabled, indeterminate }: {
  checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean; indeterminate?: boolean;
}) {
  const { colors } = useTheme();
  const on = checked || indeterminate;
  return (
    <Pressable
      onPress={() => onChange(!checked)}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: indeterminate ? 'mixed' : checked, disabled: !!disabled }}
      accessibilityLabel={label}
      hitSlop={6}
      style={({ hovered }: any) => [
        styles.checkHit,
        Platform.OS === 'web' && ({ cursor: disabled ? 'not-allowed' : 'pointer' } as any),
        hovered && !disabled ? { backgroundColor: colors.surfaceSunken } : null,
      ]}
    >
      <View
        style={[
          styles.checkBox,
          {
            borderColor: on ? colors.primary : colors.borderStrong,
            backgroundColor: on ? colors.primary : colors.surface,
            opacity: disabled ? 0.5 : 1,
          },
        ]}
      >
        {on ? <Ionicons name={indeterminate ? 'remove' : 'checkmark'} size={15} color={colors.primaryText} /> : null}
      </View>
    </Pressable>
  );
}

/** A label + hint wrapper for non-Input controls (chips, segmented, etc.) so they align with Inputs. */
export function Field({ label, hint, error, children, required, style, right }: {
  label: string; hint?: string; error?: string | null; children: React.ReactNode; required?: boolean; style?: StyleProp<ViewStyle>; right?: React.ReactNode;
}) {
  return (
    <View style={[{ gap: 6 }, style]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <Text variant="smallStrong" tone="muted">
          {label}
          {required ? <Text variant="smallStrong" tone="danger"> *</Text> : null}
        </Text>
        {right}
      </View>
      {children}
      {error ? <Text variant="small" tone="danger">{error}</Text> : hint ? <Text variant="small" tone="subtle">{hint}</Text> : null}
    </View>
  );
}

export function ChoiceChips<T extends string | number | null>({ value, options, onChange }: {
  value: T; options: { value: T; label: string; icon?: IconName }[]; onChange: (v: T) => void;
}) {
  return (
    <View style={styles.wrap} accessibilityRole="radiogroup">
      {options.map((o) => (
        <Chip key={String(o.value)} label={o.label} icon={o.icon} selected={o.value === value} onPress={() => onChange(o.value)} />
      ))}
    </View>
  );
}

/** Titled card section used to group long forms. */
export function FormSection({ title, subtitle, icon, children, right }: {
  title: string; subtitle?: string; icon?: IconName; children: React.ReactNode; right?: React.ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.section, { borderColor: colors.border, backgroundColor: colors.surface }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        {icon ? (
          <View style={[styles.sectionIcon, { backgroundColor: colors.primarySoft }]}>
            <Ionicons name={icon} size={16} color={colors.primarySoftText} />
          </View>
        ) : null}
        <View style={{ flex: 1 }}>
          <Text variant="h3">{title}</Text>
          {subtitle ? <Text variant="small" tone="muted">{subtitle}</Text> : null}
        </View>
        {right}
      </View>
      {children}
    </View>
  );
}

export function Collapsible({ title, icon, children, defaultOpen = false, tone = 'default', count }: {
  title: string; icon?: IconName; children: React.ReactNode; defaultOpen?: boolean; tone?: 'default' | 'warning'; count?: number;
}) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(defaultOpen);
  const warning = tone === 'warning';
  return (
    <Card padded={false} style={warning ? { borderColor: colors.warning, backgroundColor: colors.warningSoft } : undefined}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={title}
        style={[styles.collapseHead, Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}
      >
        {icon ? <Ionicons name={icon} size={18} color={warning ? colors.warningText : colors.textMuted} /> : null}
        <Text variant="bodyStrong" tone={warning ? 'warning' : 'default'} style={{ flex: 1 }}>
          {title}{count !== undefined ? ` (${count})` : ''}
        </Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textSubtle} />
      </Pressable>
      {open ? <View style={{ paddingHorizontal: 16, paddingBottom: 16, gap: 6 }}>{children}</View> : null}
    </Card>
  );
}

export function NoAccess({ title, message }: { title: string; message: string }) {
  return (
    <EmptyState
      icon="lock-closed-outline"
      title={title}
      message={message}
      action={{ label: 'Go to billing', icon: 'receipt-outline', onPress: () => router.navigate('/pos' as Href) }}
    />
  );
}

/** Stepper for whole-number quantities (label copies etc.). */
export function Stepper({ value, onChange, min = 0, max = 999, label }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; label: string;
}) {
  const { colors, radius } = useTheme();
  const btn = (icon: IconName, delta: number, a11y: string) => {
    const disabled = delta < 0 ? value <= min : value >= max;
    return (
      <Pressable
        onPress={() => onChange(Math.min(max, Math.max(min, value + delta)))}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={`${a11y} ${label}`}
        style={({ hovered }: any) => [
          styles.stepBtn,
          { opacity: disabled ? 0.35 : 1, backgroundColor: hovered ? colors.surfaceSunken : 'transparent' },
          Platform.OS === 'web' && ({ cursor: disabled ? 'not-allowed' : 'pointer' } as any),
        ]}
      >
        <Ionicons name={icon} size={18} color={colors.text} />
      </Pressable>
    );
  };
  return (
    <View style={[styles.stepper, { borderColor: colors.border, borderRadius: radius.md }]}>
      {btn('remove', -1, 'Decrease')}
      <Text variant="bodyStrong" style={{ minWidth: 28, textAlign: 'center' }} accessibilityLabel={`${label}: ${value}`}>{value}</Text>
      {btn('add', 1, 'Increase')}
    </View>
  );
}

const styles = StyleSheet.create({
  checkHit: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
  checkBox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  section: { borderWidth: 1, borderRadius: 14, padding: 16, gap: 14 },
  sectionIcon: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  collapseHead: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, minHeight: 52 },
  stepper: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, alignSelf: 'flex-start' },
  stepBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
});
