import React from 'react';
import { Linking, Platform, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { crmApi } from '@/api/endpoints';
import type { Customer } from '@/api/types';
import { Badge, Button, Card, ErrorState, Loading, Text, toast, type BadgeTone } from '@/components/ui';
import { useApi } from '@/hooks/useApi';
import { useData } from '@/store/data';
import { CHANNEL_LABEL, ORDER_TYPE_LABEL, formatDate, formatDateTime, money } from '@/lib/format';
import { useTheme } from '@/theme/ThemeProvider';
import { formatMobile, whatsappUrl } from '@/features/settings/validation';

export const TIER_TONE: Record<Customer['tier'], BadgeTone> = { Gold: 'accent', Silver: 'info', Bronze: 'neutral' };

export function tierProgress(points: number): { next: Customer['tier'] | null; needed: number; pct: number } {
  if (points >= 500) return { next: null, needed: 0, pct: 1 };
  if (points >= 100) return { next: 'Gold', needed: 500 - points, pct: (points - 100) / 400 };
  return { next: 'Silver', needed: 100 - points, pct: points / 100 };
}

import { initials } from '@/lib/initials';
export { initials };

async function open(url: string, what: string) {
  try {
    if (Platform.OS !== 'web' && !(await Linking.canOpenURL(url))) {
      toast.error(`No app on this device can ${what}.`);
      return;
    }
    await Linking.openURL(url);
  } catch {
    toast.error(`Could not ${what}.`);
  }
}

const STATUS_TONE: Record<string, BadgeTone> = { completed: 'success', open: 'info', placed: 'warning', cancelled: 'danger' };

/** Customer profile with stats and order history. Used in the desktop side pane and the phone sheet. */
export function CustomerDetail({ customer, onEdit, canEdit, compactHeader }: { customer: Customer; onEdit: () => void; canEdit: boolean; compactHeader?: boolean }) {
  const { colors } = useTheme();
  const settings = useData((s) => s.settings);
  const { data, error, loading, reload } = useApi(() => crmApi.get(customer.id), [customer.id, customer.points, customer.name, customer.phone]);
  const c = { ...customer, ...(data ?? {}) };
  const avg = c.visits ? c.total_spent / c.visits : 0;
  const progress = tierProgress(c.points);
  const wa = whatsappUrl(c.phone);
  const deleted = c.phone.startsWith('deleted-');
  const pointValue = settings?.loyalty_point_value ?? 0;

  return (
    <View style={{ gap: 16 }}>
      {!compactHeader ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
            <Text variant="h3" color={colors.primarySoftText}>{initials(c.name)}</Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text variant="h2" numberOfLines={1}>{c.name}</Text>
            <Text tone="muted" selectable>{formatMobile(c.phone)}</Text>
          </View>
          <Badge label={c.tier} tone={TIER_TONE[c.tier]} icon="ribbon-outline" />
        </View>
      ) : null}

      {!deleted ? (
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <Button title="Call" icon="call-outline" variant="secondary" size="sm" onPress={() => open(`tel:${c.phone.replace(/\s/g, '')}`, 'make calls')} />
          {wa ? <Button title="WhatsApp" icon="logo-whatsapp" variant="secondary" size="sm" onPress={() => open(wa, 'open WhatsApp')} /> : null}
          {c.email ? <Button title="Email" icon="mail-outline" variant="secondary" size="sm" onPress={() => open(`mailto:${c.email}`, 'send email')} /> : null}
          {canEdit ? <Button title="Edit" icon="create-outline" variant="ghost" size="sm" onPress={onEdit} /> : null}
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        <MiniStat label="Total spent" value={money(c.total_spent, '₹', true)} />
        <MiniStat label="Visits" value={String(c.visits)} />
        <MiniStat label="Average bill" value={c.visits ? money(avg, '₹', true) : '—'} />
        <MiniStat label="Points" value={String(c.points)} hint={pointValue && c.points ? `worth ${money(c.points * pointValue, '₹', true)}` : undefined} />
      </View>

      <Card style={{ gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text variant="smallStrong">{c.tier} member</Text>
          <Text variant="small" tone="muted">{progress.next ? `${progress.needed} points to ${progress.next}` : 'Top tier'}</Text>
        </View>
        <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.surfaceSunken, overflow: 'hidden' }} accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: 100, now: Math.round(progress.pct * 100) }}>
          <View style={{ width: `${Math.round(progress.pct * 100)}%`, height: 6, backgroundColor: colors.accent }} />
        </View>
        <Text variant="small" tone="subtle">Silver from 100 points, Gold from 500.{settings && !settings.loyalty_enabled ? ' Loyalty is off in Business settings.' : ''}</Text>
      </Card>

      <Card style={{ gap: 10 }}>
        <Detail icon={c.marketing_opt_in ? 'mail' : 'mail-unread-outline'} label="Email offers"
          value={c.marketing_opt_in
            ? c.email ? 'Agreed to receive offers by email' : 'Agreed, but no email address saved yet'
            : 'Not agreed — gets receipts and rewards only'} />
        {c.last_visit_at ? <Detail icon="time-outline" label="Last visit" value={formatDateTime(c.last_visit_at)} /> : null}
        {c.email ? <Detail icon="mail-outline" label="Email" value={c.email} /> : null}
        {c.notes ? <Detail icon="document-text-outline" label="Notes" value={c.notes} /> : null}
      </Card>

      <View style={{ gap: 8 }}>
        <Text variant="caption" tone="subtle" style={{ textTransform: 'uppercase' }}>Order history</Text>
        {loading && !data ? <Loading /> : null}
        {error && !data ? <ErrorState message={error} onRetry={reload} /> : null}
        {data && data.orders.length === 0 ? (
          <Card><Text tone="muted" align="center">No bills yet. Bills appear here when this phone number is added at checkout.</Text></Card>
        ) : null}
        {data && data.orders.length > 0 ? (
          <Card padded={false}>
            {data.orders.map((o, i) => (
              <View key={o.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12, borderTopWidth: i ? 1 : 0, borderTopColor: colors.divider }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text variant="smallStrong" numberOfLines={1}>{o.invoice_no ?? `#${o.code}`}</Text>
                  <Text variant="small" tone="muted" numberOfLines={1}>
                    {formatDate(o.created_at)} · {o.channel !== 'POS' ? CHANNEL_LABEL[o.channel] ?? o.channel : ORDER_TYPE_LABEL[o.type] ?? o.type}
                  </Text>
                </View>
                {o.status !== 'completed' ? <Badge label={o.status === 'open' ? 'Open' : o.status === 'placed' ? 'New' : 'Cancelled'} tone={STATUS_TONE[o.status] ?? 'neutral'} /> : null}
                <Text variant="money" style={o.status === 'cancelled' ? { textDecorationLine: 'line-through', color: colors.textSubtle } : undefined}>{money(o.total_amount)}</Text>
              </View>
            ))}
          </Card>
        ) : null}
        {data && data.orders.length >= 50 ? <Text variant="small" tone="subtle">Showing the latest 50 bills.</Text> : null}
      </View>
    </View>
  );
}

function MiniStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexGrow: 1, flexBasis: 120, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: 2 }}>
      <Text variant="small" tone="muted">{label}</Text>
      <Text variant="h3" numberOfLines={1}>{value}</Text>
      {hint ? <Text variant="caption" tone="subtle">{hint}</Text> : null}
    </View>
  );
}

function Detail({ icon, label, value }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
      <Ionicons name={icon} size={16} color={colors.textSubtle} style={{ marginTop: 2 }} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="small" tone="muted">{label}</Text>
        <Text selectable>{value}</Text>
      </View>
    </View>
  );
}
