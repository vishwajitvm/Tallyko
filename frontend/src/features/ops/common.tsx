/**
 * Small building blocks shared by the operations screens (Orders, Online, Tables, Kitchen).
 */
import React, { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme/ThemeProvider';
import { Badge, Sheet, StatusPill, Text, toast, type BadgeTone } from '@/components/ui';
import type { ChannelCode, Order, OrderStatus } from '@/api/types';
import { CHANNEL_LABEL, PAYMENT_LABEL, ORDER_TYPE_LABEL, formatDateTime, money } from '@/lib/format';
import { getServerUrl } from '@/store/prefs';
import { isCompItem, isVoidItem } from '@/lib/billing';

type IconName = keyof typeof Ionicons.glyphMap;

// ---------- Time ----------

/** Re-renders the caller every `ms` so age timers stay current. */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** Debounced copy of a value (search boxes). */
export function useDebounced<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function ageLabel(minutes: number): string {
  if (minutes < 1) return 'Now';
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  return `${h}h ${minutes % 60}m`;
}

// ---------- Channels ----------

export const CHANNEL_TONE: Record<string, BadgeTone> = {
  POS: 'neutral', QR: 'info', ONLINE: 'primary', SWIGGY: 'accent', ZOMATO: 'danger', ONDC: 'info', MAGICPIN: 'primary', OTHER: 'neutral',
};

const CHANNEL_INITIALS: Record<string, string> = {
  POS: 'PO', QR: 'QR', ONLINE: 'WEB', SWIGGY: 'S', ZOMATO: 'Z', ONDC: 'ON', MAGICPIN: 'MP', OTHER: '•••',
};

const CHANNEL_ICON: Record<string, IconName> = {
  POS: 'storefront-outline', QR: 'qr-code-outline', ONLINE: 'globe-outline', OTHER: 'call-outline',
};

export const AGGREGATOR_CODES: ChannelCode[] = ['SWIGGY', 'ZOMATO', 'ONDC', 'MAGICPIN', 'OTHER'];

export function channelLabel(code: string): string {
  return CHANNEL_LABEL[code] ?? code;
}

/** Logo-style square tile for a sales channel (brand-ish tone from theme tokens). */
export function ChannelTile({ code, size = 44 }: { code: string; size?: number }) {
  const { colors } = useTheme();
  const tone = CHANNEL_TONE[code] ?? 'neutral';
  const map: Record<BadgeTone, [string, string, string]> = {
    neutral: [colors.surfaceSunken, colors.textMuted, colors.border],
    primary: [colors.primarySoft, colors.primarySoftText, colors.primary],
    success: [colors.successSoft, colors.successText, colors.success],
    warning: [colors.warningSoft, colors.warningText, colors.warning],
    danger: [colors.dangerSoft, colors.dangerText, colors.danger],
    info: [colors.infoSoft, colors.infoText, colors.info],
    accent: [colors.accentSoft, colors.accentText, colors.accent],
  };
  const [bg, fg, border] = map[tone];
  const icon = CHANNEL_ICON[code];
  return (
    <View accessibilityLabel={channelLabel(code)}
      style={{ width: size, height: size, borderRadius: size * 0.28, backgroundColor: bg, borderColor: border, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' }}>
      {icon ? <Ionicons name={icon} size={size * 0.48} color={fg} /> : (
        <Text variant={size >= 40 ? 'h3' : 'smallStrong'} color={fg} style={{ fontSize: size * (CHANNEL_INITIALS[code]?.length > 1 ? 0.32 : 0.46) }}>
          {CHANNEL_INITIALS[code] ?? code.slice(0, 2)}
        </Text>
      )}
    </View>
  );
}

export function ChannelBadge({ code }: { code: string }) {
  return <Badge label={channelLabel(code)} tone={CHANNEL_TONE[code] ?? 'neutral'} />;
}

// ---------- Order status ----------

/** Order status pill: same colours as everywhere else (StatusPill, docs/20 §4). */
export function StatusBadge({ status }: { status: OrderStatus }) {
  return <StatusPill status={status} />;
}

export function PaymentBadge({ order }: { order: Pick<Order, 'payment_status' | 'status' | 'balance_due'> }) {
  if (order.status === 'cancelled' || order.status === 'merged') return null;
  return <StatusPill status={order.payment_status || 'unpaid'} />;
}

export function billNo(order: Pick<Order, 'invoice_no' | 'code'>): string {
  return order.invoice_no ?? `#${order.code}`;
}

/** Items the customer gets (cancelled lines left out). */
export function itemCount(order: Pick<Order, 'items'>): number {
  return order.items.filter((i) => !isVoidItem(i)).reduce((s, i) => s + i.quantity, 0);
}

// ---------- Customer ordering link ----------

/** Public origin the customer's phone should open (web: this site; apps: the server host without /api/v1). */
export function publicOrigin(): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.origin) return window.location.origin;
  return getServerUrl().replace(/\/api\/v\d+\/?$/, '').replace(/\/+$/, '');
}

export function tableOrderUrl(tenantId: string, tableId: string): string {
  return `${publicOrigin()}/store/${tenantId}?table=${tableId}`;
}

// ---------- Share ----------

export function billText(order: Order, businessName: string, symbol = '₹'): string {
  const lines: string[] = [];
  lines.push(businessName);
  lines.push(`Bill ${billNo(order)} · ${formatDateTime(order.created_at)}`);
  const meta = [ORDER_TYPE_LABEL[order.type] ?? order.type];
  if (order.table_label) meta.push(`Table ${order.table_label}`);
  if (order.channel !== 'POS') meta.push(channelLabel(order.channel));
  lines.push(meta.join(' · '));
  if (order.customer_name) lines.push(`Customer: ${order.customer_name}${order.customer_phone ? ` (${order.customer_phone})` : ''}`);
  lines.push('');
  for (const i of order.items) {
    if (isVoidItem(i)) continue;
    const comp = isCompItem(i);
    lines.push(`${i.quantity} x ${i.name}${i.variant_name ? ` (${i.variant_name})` : ''} — ${comp ? `${money(0, symbol)} (on the house)` : money(i.line_total, symbol)}`);
  }
  lines.push('');
  lines.push(`Subtotal: ${money(order.subtotal, symbol)}`);
  if (order.discount_amount) lines.push(`Discount: -${money(order.discount_amount, symbol)}`);
  if (order.tax_amount) lines.push(`GST: ${money(order.tax_amount, symbol)}`);
  if (order.round_off) lines.push(`Round off: ${money(order.round_off, symbol)}`);
  lines.push(`Total: ${money(order.total_amount, symbol)}`);
  if (order.payments.length) lines.push(`Paid: ${order.payments.map((p) => `${PAYMENT_LABEL[p.method] ?? p.method} ${money(p.amount, symbol)}`).join(', ')}`);
  if (order.status === 'cancelled') lines.push('*** CANCELLED ***');
  if (order.status === 'merged') lines.push('*** MERGED INTO ANOTHER BILL ***');
  lines.push('');
  lines.push('Thank you!');
  return lines.join('\n');
}

export async function shareText(text: string, title: string): Promise<void> {
  if (Platform.OS === 'web') {
    const nav: any = typeof navigator !== 'undefined' ? navigator : null;
    if (nav?.share) {
      try {
        await nav.share({ title, text });
        return;
      } catch (e: any) {
        if (e?.name === 'AbortError') return;
      }
    }
    if (nav?.clipboard?.writeText) {
      await nav.clipboard.writeText(text);
      toast.success('Bill copied — paste it into WhatsApp or SMS');
      return;
    }
    throw new Error('Sharing is not available in this browser.');
  }
  await Share.share({ message: text, title });
}

// ---------- Action menu ----------

export interface MenuAction {
  label: string;
  icon: IconName;
  onPress: () => void;
  subtitle?: string;
  danger?: boolean;
  disabled?: boolean;
}

/** A simple list of actions in a sheet (long-press menus, pickers). */
export function ActionMenu({ visible, onClose, title, subtitle, actions, children }: {
  visible: boolean; onClose: () => void; title: string; subtitle?: string; actions: MenuAction[]; children?: React.ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <Sheet visible={visible} onClose={onClose} title={title} subtitle={subtitle} width={420}>
      {children}
      <View style={{ gap: 2, marginHorizontal: -8 }}>
        {actions.map((a) => (
          <Pressable key={a.label} disabled={a.disabled} accessibilityRole="button" accessibilityLabel={a.label}
            onPress={() => { onClose(); setTimeout(a.onPress, Platform.OS === 'web' ? 0 : 250); }}
            style={({ pressed, hovered }: any) => [
              styles.menuRow,
              (pressed || hovered) && { backgroundColor: colors.surfaceSunken },
              a.disabled && { opacity: 0.45 },
              Platform.OS === 'web' && ({ cursor: a.disabled ? 'not-allowed' : 'pointer' } as any),
            ]}>
            <View style={[styles.menuIcon, { backgroundColor: a.danger ? colors.dangerSoft : colors.surfaceSunken }]}>
              <Ionicons name={a.icon} size={18} color={a.danger ? colors.danger : colors.textMuted} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text variant="bodyStrong" tone={a.danger ? 'danger' : 'default'} numberOfLines={1}>{a.label}</Text>
              {a.subtitle ? <Text variant="small" tone="muted" numberOfLines={2}>{a.subtitle}</Text> : null}
            </View>
          </Pressable>
        ))}
      </View>
    </Sheet>
  );
}

// ---------- Layout helpers ----------

/** Horizontally scrolling chip row that never wraps or overflows. */
export function ChipRow({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow} style={{ flexGrow: 0 }}>
      {children}
    </ScrollView>
  );
}

/** Inline notice (tip / warning) with optional action. */
export function Notice({ tone = 'info', icon, title, message, action, onClose }: {
  tone?: 'info' | 'warning' | 'danger' | 'neutral'; icon?: IconName; title?: string; message: string;
  action?: { label: string; onPress: () => void }; onClose?: () => void;
}) {
  const { colors, radius } = useTheme();
  const map = {
    info: [colors.infoSoft, colors.infoText, 'information-circle'],
    warning: [colors.warningSoft, colors.warningText, 'warning'],
    danger: [colors.dangerSoft, colors.dangerText, 'alert-circle'],
    neutral: [colors.surfaceSunken, colors.textMuted, 'bulb-outline'],
  } as const;
  const [bg, fg, defIcon] = map[tone];
  return (
    <View style={[styles.notice, { backgroundColor: bg, borderRadius: radius.lg }]}>
      <Ionicons name={icon ?? (defIcon as IconName)} size={20} color={fg} style={{ marginTop: 1 }} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        {title ? <Text variant="smallStrong" color={fg}>{title}</Text> : null}
        <Text variant="small" color={fg}>{message}</Text>
        {action ? (
          <Pressable onPress={action.onPress} accessibilityRole="button" hitSlop={10} style={{ alignSelf: 'flex-start', marginTop: 4 }}>
            <Text variant="smallStrong" color={fg} style={{ textDecorationLine: 'underline' }}>{action.label}</Text>
          </Pressable>
        ) : null}
      </View>
      {onClose ? (
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Dismiss" hitSlop={12}>
          <Ionicons name="close" size={18} color={fg} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** Responsive grid: as many columns of at least `minItemWidth` as fit the measured width. */
export function Grid({ minItemWidth, gap = 16, children, maxColumns = 6 }: { minItemWidth: number; gap?: number; children: React.ReactNode; maxColumns?: number }) {
  const [width, setWidth] = useState(0);
  const items = React.Children.toArray(children);
  const columns = width ? Math.max(1, Math.min(maxColumns, Math.floor((width + gap) / (minItemWidth + gap)))) : 1;
  const itemWidth = width ? Math.floor((width - gap * (columns - 1)) / columns) : undefined;
  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ flexDirection: 'row', flexWrap: 'wrap', gap, alignItems: 'stretch' }}>
      {items.map((child, i) => (
        <View key={(child as any)?.key ?? i} style={{ width: itemWidth ?? '100%' }}>{child}</View>
      ))}
    </View>
  );
}

/** Two-note chime on web for new orders (no extra dependencies). Silently does nothing elsewhere. */
export function playChime() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  try {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [880, 1318.5].forEach((freq, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const t = ctx.currentTime + i * 0.22;
      o.type = 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
      o.connect(g);
      g.connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.5);
    });
    setTimeout(() => void ctx.close?.(), 1200);
  } catch {
    /* audio blocked — ignore */
  }
}

/** Grey placeholder blocks shown while a list loads. */
export function SkeletonRows({ count = 6, height = 64 }: { count?: number; height?: number }) {
  const { colors, radius } = useTheme();
  const [on, setOn] = useState(true);
  useEffect(() => {
    const id = setInterval(() => setOn((v) => !v), 700);
    return () => clearInterval(id);
  }, []);
  return (
    <View style={{ gap: 10 }} accessibilityLabel="Loading" accessibilityRole="progressbar">
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={{ height, borderRadius: radius.lg, backgroundColor: colors.surfaceSunken, opacity: on ? 1 : 0.55,
          ...(Platform.OS === 'web' ? ({ transitionDuration: '700ms' } as any) : null) }} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingHorizontal: 8, paddingVertical: 8, borderRadius: 10 },
  menuIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  chipRow: { gap: 8, paddingVertical: 2, alignItems: 'center' },
  notice: { flexDirection: 'row', gap: 10, padding: 12, alignItems: 'flex-start' },
});
