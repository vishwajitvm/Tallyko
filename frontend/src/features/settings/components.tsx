/**
 * Building blocks shared by the settings and customer screens (form sections, callouts, sticky save bar,
 * copy/share helpers). They compose the design-system primitives in `@/components/ui`.
 */
import React from 'react';
import { Platform, Pressable, Share, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button, Card, SwitchRow, Text, toast, useHotkeys } from '@/components/ui';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import { getServerUrl } from '@/store/prefs';

type IconName = keyof typeof Ionicons.glyphMap;

// ---------------------------------------------------------------------------
// Clipboard / share (no clipboard module in the app: web uses the async clipboard API, native uses the share sheet)
// ---------------------------------------------------------------------------

export async function copyText(text: string, what = 'Copied'): Promise<void> {
  if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${what} copied`);
      return;
    } catch {
      // Clipboard can be blocked (http, iframe): fall through to share / manual copy.
    }
  }
  await shareText(text, what);
}

export async function shareText(text: string, title?: string): Promise<void> {
  if (Platform.OS === 'web') {
    const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { share?: (d: { text?: string; title?: string }) => Promise<void> }) : null;
    if (nav?.share) {
      try {
        await nav.share({ text, title });
        return;
      } catch {
        return; // user closed the share sheet
      }
    }
    toast.info('Select the text and copy it manually.');
    return;
  }
  try {
    await Share.share({ message: text, title });
  } catch {
    toast.error('Could not open the share sheet.');
  }
}

/** Origin of the Tallyko API server (the configured server URL minus /api/v1). */
export function serverOrigin(): string {
  return getServerUrl().replace(/\/api\/v\d+\/?$/, '');
}

/**
 * Origin of the customer-facing web app (store and QR pages). On web it is the page's own origin;
 * the apps assume the web app is served from the same address as the API (the standard proxy setup).
 */
export function webAppOrigin(): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined') return window.location.origin;
  return serverOrigin();
}

export function apiBase(): string {
  return getServerUrl().replace(/\/+$/, '');
}

// ---------------------------------------------------------------------------
// Layout pieces
// ---------------------------------------------------------------------------

/**
 * Stripe-style form section: title + description on the left on wide screens, fields in a card on the right.
 * On phones the description sits above the card.
 */
export function FormSection({ title, description, children, right, onLayout, style, footer, stacked, nativeID }: {
  title: string; description?: string; children: React.ReactNode; right?: React.ReactNode;
  onLayout?: (y: number) => void; style?: StyleProp<ViewStyle>; footer?: React.ReactNode; nativeID?: string;
  /** Always put the title above the card (for narrow columns). */
  stacked?: boolean;
}) {
  // Two columns only when there is room next to both the app sidebar and the settings navigation.
  const { width } = useLayout();
  const twoCol = !stacked && width >= 1360;
  return (
    <View
      nativeID={nativeID}
      onLayout={onLayout ? (e) => onLayout(e.nativeEvent.layout.y) : undefined}
      style={[twoCol ? styles.sectionRow : styles.sectionCol, style]}
    >
      <View style={twoCol ? styles.sectionAside : styles.sectionHead}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
          <Text variant="h3" accessibilityRole="header" style={{ flexShrink: 1 }}>{title}</Text>
          {!twoCol ? right : null}
        </View>
        {description ? <Text variant="small" tone="muted">{description}</Text> : null}
        {twoCol && right ? <View style={{ marginTop: 8, alignItems: 'flex-start' }}>{right}</View> : null}
      </View>
      <Card style={[{ gap: 16 }, twoCol && { flex: 1, minWidth: 0 }]}>
        {children}
        {footer}
      </Card>
    </View>
  );
}

/** Puts two or three fields side by side on tablets/desktops, stacked on phones. */
export function FieldRow({ children }: { children: React.ReactNode }) {
  const { isPhone } = useLayout();
  const items = React.Children.toArray(children).filter(Boolean);
  if (isPhone) return <View style={{ gap: 16 }}>{items}</View>;
  return (
    <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
      {items.map((child, i) => (
        <View key={i} style={{ flex: 1, minWidth: 0 }}>{child}</View>
      ))}
    </View>
  );
}

export type CalloutTone = 'info' | 'warning' | 'danger' | 'success' | 'neutral';

export function Callout({ tone = 'info', icon, title, children, action, style }: {
  tone?: CalloutTone; icon?: IconName; title?: string; children?: React.ReactNode; action?: React.ReactNode; style?: StyleProp<ViewStyle>;
}) {
  const { colors, radius } = useTheme();
  const map: Record<CalloutTone, { bg: string; fg: string; icon: IconName }> = {
    info: { bg: colors.infoSoft, fg: colors.infoText, icon: 'information-circle' },
    warning: { bg: colors.warningSoft, fg: colors.warningText, icon: 'warning' },
    danger: { bg: colors.dangerSoft, fg: colors.dangerText, icon: 'alert-circle' },
    success: { bg: colors.successSoft, fg: colors.successText, icon: 'checkmark-circle' },
    neutral: { bg: colors.surfaceSunken, fg: colors.textMuted, icon: 'bulb-outline' },
  };
  const t = map[tone];
  return (
    <View style={[styles.callout, { backgroundColor: t.bg, borderRadius: radius.md }, style]} accessibilityRole={tone === 'danger' || tone === 'warning' ? 'alert' : undefined}>
      <Ionicons name={icon ?? t.icon} size={18} color={t.fg} style={{ marginTop: 2 }} />
      <View style={{ flex: 1, gap: 4, minWidth: 0 }}>
        {title ? <Text variant="smallStrong" color={t.fg}>{title}</Text> : null}
        {typeof children === 'string' ? <Text variant="small" color={tone === 'neutral' ? colors.textMuted : colors.text}>{children}</Text> : children}
        {action ? <View style={{ marginTop: 6, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{action}</View> : null}
      </View>
    </View>
  );
}

/**
 * Sticky bar at the bottom of a settings form while there are unsaved changes: what changed on the left, Discard and Save
 * on the right (thumb reach on phones). Ctrl+S saves on desktop.
 */
export function SaveBar({ visible, saving, onSave, onDiscard, message = 'You have unsaved changes', disabled, saveLabel = 'Save changes' }: {
  visible: boolean; saving: boolean; onSave: () => void; onDiscard: () => void; message?: string; disabled?: boolean; saveLabel?: string;
}) {
  const { colors, shadow } = useTheme();
  const { isPhone } = useLayout();
  useHotkeys({ 'Ctrl+S': () => { if (!saving && !disabled) onSave(); } }, [saving, disabled, onSave], { enabled: visible });
  if (!visible) return null;
  return (
    <View style={[styles.saveBar, shadow(2), { backgroundColor: colors.surface, borderTopColor: colors.border, paddingHorizontal: isPhone ? 12 : 24 }]}
      accessibilityLiveRegion="polite">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
        <View style={[styles.dot, { backgroundColor: colors.warning }]} />
        <Text variant="smallStrong" numberOfLines={isPhone ? 2 : 1} style={{ flexShrink: 1 }}>{message}</Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button title="Discard" variant="outline" onPress={onDiscard} disabled={saving} />
        <Button title={isPhone ? 'Save' : saveLabel} icon="checkmark" onPress={onSave} loading={saving} disabled={disabled} shortcut="Ctrl+S" />
      </View>
    </View>
  );
}

/** Chips for picking one value from a short list (GST rates, roles...). */
export function ChoiceChips<T extends string | number>({ value, options, onChange, accessibilityLabel }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; accessibilityLabel?: string;
}) {
  const { colors, radius } = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            accessibilityRole="radio"
            accessibilityState={{ checked: active }}
            accessibilityLabel={o.label}
            onPress={() => onChange(o.value)}
            style={({ hovered }: any) => [
              styles.choice,
              {
                borderRadius: radius.md,
                borderColor: active ? colors.primary : colors.border,
                backgroundColor: active ? colors.primarySoft : hovered ? colors.surfaceSunken : colors.surface,
              },
              Platform.OS === 'web' && ({ cursor: 'pointer' } as any),
            ]}
          >
            <Text variant="smallStrong" color={active ? colors.primarySoftText : colors.text}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Label/value line for read-only details. */
export function KeyValue({ label, value, mono, right }: { label: string; value: string; mono?: boolean; right?: React.ReactNode }) {
  return (
    <View style={styles.kv}>
      <Text variant="small" tone="muted" style={{ width: 120 }}>{label}</Text>
      <Text variant="bodyStrong" style={[{ flex: 1, minWidth: 0 }, mono && styles.mono]} selectable numberOfLines={2}>{value}</Text>
      {right}
    </View>
  );
}

/** Small round status icon: green tick or grey/amber circle. */
export function StatusDot({ ok, warn }: { ok: boolean; warn?: boolean }) {
  const { colors } = useTheme();
  if (ok) return <Ionicons name="checkmark-circle" size={20} color={colors.success} accessibilityLabel="Done" />;
  return <Ionicons name={warn ? 'alert-circle' : 'ellipse-outline'} size={20} color={warn ? colors.warning : colors.textSubtle} accessibilityLabel="Not done" />;
}

/** SwitchRow aligned with the inputs of a padded Card (SwitchRow carries its own 12px row padding). */
export function SettingSwitch(props: React.ComponentProps<typeof SwitchRow>) {
  return (
    <View style={{ marginHorizontal: -12, marginVertical: -6 }}>
      <SwitchRow {...props} />
    </View>
  );
}

/** Full-bleed divider inside a padded Card. */
export function Hairline() {
  const { colors } = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth * 2, backgroundColor: colors.divider, marginHorizontal: -16 }} />;
}

export const monoFont = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' });

const styles = StyleSheet.create({
  sectionRow: { flexDirection: 'row', gap: 32, alignItems: 'flex-start' },
  sectionCol: { gap: 10 },
  sectionAside: { width: 240, gap: 4, paddingTop: 4 },
  sectionHead: { gap: 2, paddingHorizontal: 2 },
  callout: { flexDirection: 'row', gap: 10, padding: 12, alignItems: 'flex-start' },
  saveBar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderTopWidth: 1, minHeight: 64 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  choice: { minHeight: 44, minWidth: 56, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5 },
  kv: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 36 },
  mono: { fontFamily: monoFont },
});
