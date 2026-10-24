/** Small pickers used by the POS: variant, table, channel, discount, customer, running orders. */
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ChannelCode, Customer, DiscountInput, Order, Product, SalesChannel, TableInfo } from '@/api/types';
import { crmApi, ordersApi, tablesApi } from '@/api/endpoints';
import { errorMessage, isOffline } from '@/api/client';
import { Badge, Button, Chip, EmptyState, Input, ListRow, Segmented, Sheet, Text, VegMark, toast } from '@/components/ui';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import { useData } from '@/store/data';
import { ago, CHANNEL_LABEL, money, ORDER_TYPE_LABEL, round2 } from '@/lib/format';
import { unitPriceFor } from '@/lib/billing';
import type { AttachedCustomer } from './cart';
import { PHONE_RE, POS_CHANNELS } from './totals';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

// ---------------------------------------------------------------------------
// Variant picker
// ---------------------------------------------------------------------------

export function VariantSheet({ product, onClose, onPick, currency, adjustPct, channel = 'POS' }: {
  product: Product | null; onClose: () => void; onPick: (variantId: string) => void; currency: string; adjustPct: number; channel?: ChannelCode;
}) {
  const { colors, radius } = useTheme();
  const { isPhone } = useLayout();
  useEffect(() => {
    if (!product || Platform.OS !== 'web' || typeof window === 'undefined') return undefined;
    const onKey = (e: KeyboardEvent) => {
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= product.variants.length) {
        e.preventDefault();
        onPick(product.variants[n - 1].id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [product, onPick]);

  return (
    <Sheet visible={!!product} onClose={onClose} title={product?.name} subtitle="Choose an option" width={480}>
      {product ? (
        <View style={styles.variantGrid}>
          {product.variants.map((v, i) => (
            <Pressable key={v.id} onPress={() => onPick(v.id)} accessibilityRole="button" accessibilityLabel={`${v.name}, ${money(unitPriceFor(product, v.id, adjustPct, channel), currency)}`}
              style={({ pressed, hovered }: any) => [styles.variant, {
                borderRadius: radius.lg, borderColor: hovered ? colors.primary : colors.border,
                backgroundColor: pressed ? colors.primarySoft : hovered ? colors.surfaceAlt : colors.surface,
              }, Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <VegMark veg={product.is_veg} size={12} />
                <Text variant="h3" numberOfLines={1} style={{ flex: 1 }}>{v.name}</Text>
                {Platform.OS === 'web' && !isPhone ? <Text variant="caption" tone="subtle">{i + 1}</Text> : null}
              </View>
              <Text variant="money" tone="primary">{money(unitPriceFor(product, v.id, adjustPct, channel), currency)}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Table picker
// ---------------------------------------------------------------------------

export function TableSheet({ visible, onClose, selectedId, online, currency, onPick, onOpenRunning }: {
  visible: boolean; onClose: () => void; selectedId: string | null; online: boolean; currency: string;
  onPick: (t: TableInfo) => void; onOpenRunning: (t: TableInfo) => void;
}) {
  const { colors, radius } = useTheme();
  const cached = useData((s) => s.tables);
  const [live, setLive] = useState<TableInfo[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible || !online) return undefined;
    let alive = true;
    setLoading(true);
    tablesApi.list()
      .then((t) => { if (alive) setLive(t); })
      .catch((e) => { if (alive && !isOffline(e)) toast.error(errorMessage(e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [visible, online]);

  const tables = (live ?? cached).filter((t) => t.is_active);
  const sections = useMemo(() => {
    const map = new Map<string, TableInfo[]>();
    for (const t of tables) {
      const key = t.section || 'Tables';
      map.set(key, [...(map.get(key) ?? []), t]);
    }
    return Array.from(map.entries());
  }, [tables]);

  return (
    <Sheet visible={visible} onClose={onClose} title="Pick a table" width={640}
      subtitle={online ? (loading ? 'Checking which tables are free…' : 'Busy tables: add to their bill, or start a separate one') : 'Offline — table status may be out of date'}>
      {tables.length === 0 ? (
        <EmptyState icon="grid-outline" title="No tables yet" message="Add tables in the Tables section to take dine-in orders." />
      ) : sections.map(([section, list]) => (
        <View key={section} style={{ gap: 8 }}>
          {sections.length > 1 ? <Text variant="caption" tone="subtle" style={{ textTransform: 'uppercase' }}>{section}</Text> : null}
          <View style={styles.tableGrid}>
            {list.map((t) => {
              const busy = t.status === 'occupied' || !!t.current_order;
              const selected = t.id === selectedId;
              return (
                <Pressable key={t.id}
                  onPress={() => (busy ? onOpenRunning(t) : onPick(t))}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`Table ${t.table_number}${busy ? ', running order — add to it or start a separate bill' : ', free'}`}
                  style={({ hovered }: any) => [styles.table, {
                    borderRadius: radius.lg,
                    borderColor: selected ? colors.primary : busy ? colors.warning : hovered ? colors.borderStrong : colors.border,
                    borderWidth: selected ? 2 : 1,
                    backgroundColor: busy ? colors.warningSoft : selected ? colors.primarySoft : colors.surface,
                  }, Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}>
                  <Text variant="h2" numberOfLines={1}>{t.table_number}</Text>
                  {busy ? (
                    <Text variant="caption" tone="warning" numberOfLines={1}>
                      {(t.open_bills?.length ?? 0) > 1
                        ? `${t.open_bills!.length} bills · ${money(t.open_bills!.reduce((sum, b) => sum + b.total_amount, 0), currency, true)}`
                        : t.current_order ? `Running ${money(t.current_order.total_amount, currency, true)}` : 'Occupied'}
                    </Text>
                  ) : (
                    <Text variant="caption" tone="subtle">{t.capacity} seats</Text>
                  )}
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Sales channel
// ---------------------------------------------------------------------------

const CHANNEL_ICON: Record<string, IconName> = {
  POS: 'storefront-outline', SWIGGY: 'bicycle-outline', ZOMATO: 'restaurant-outline', ONDC: 'globe-outline', MAGICPIN: 'sparkles-outline', OTHER: 'call-outline',
};

export function posChannels(channels: SalesChannel[]): SalesChannel[] {
  return POS_CHANNELS.map((code) => channels.find((c) => c.code === code)).filter((c): c is SalesChannel => !!c && (c.enabled || c.code === 'POS'));
}

export function ChannelSheet({ visible, onClose, value, channels, onPick }: {
  visible: boolean; onClose: () => void; value: ChannelCode; channels: SalesChannel[]; onPick: (c: ChannelCode) => void;
}) {
  const { colors } = useTheme();
  const list = posChannels(channels);
  return (
    <Sheet visible={visible} onClose={onClose} title="Order from" subtitle="Punch in an aggregator or phone order" width={440}>
      <View style={{ gap: 4 }}>
        {list.map((c) => {
          const hints = [c.price_adjust_pct ? `Prices ${c.price_adjust_pct > 0 ? '+' : ''}${c.price_adjust_pct}%` : null, c.commission_pct ? `${c.commission_pct}% commission` : null].filter(Boolean).join(' · ');
          return (
            <ListRow key={c.code} title={CHANNEL_LABEL[c.code] ?? c.name} subtitle={hints || (c.code === 'POS' ? 'Walk-in customers at the counter' : undefined)}
              icon={CHANNEL_ICON[c.code] ?? 'ellipse-outline'} onPress={() => onPick(c.code)}
              right={value === c.code ? <Ionicons name="checkmark-circle" size={22} color={colors.primary} /> : <View />} />
          );
        })}
        {list.length <= 1 ? (
          <Text variant="small" tone="muted" style={{ padding: 12 }}>Turn on Swiggy, Zomato and other channels in Settings → Sales channels to punch in their orders here.</Text>
        ) : null}
      </View>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Discount
// ---------------------------------------------------------------------------

export function DiscountSheet({ visible, onClose, value, subtotal, currency, onApply }: {
  visible: boolean; onClose: () => void; value: DiscountInput | null; subtotal: number; currency: string; onApply: (d: DiscountInput | null) => void;
}) {
  const [type, setType] = useState<'flat' | 'percent'>(value?.type ?? 'percent');
  const [text, setText] = useState(value ? String(value.value) : '');
  useEffect(() => {
    if (visible) { setType(value?.type ?? 'percent'); setText(value ? String(value.value) : ''); }
  }, [visible, value]);

  const n = Number(text.replace(/,/g, ''));
  const error = !text ? null : !Number.isFinite(n) || n < 0 ? 'Enter a valid number'
    : type === 'percent' && n > 100 ? 'Percent cannot be more than 100'
    : type === 'flat' && n > subtotal ? `Cannot be more than the subtotal (${money(subtotal, currency)})` : null;
  const amount = !error && n > 0 ? (type === 'percent' ? round2((subtotal * n) / 100) : n) : 0;
  const apply = () => { if (!error) onApply(n > 0 ? { type, value: round2(n) } : null); };

  return (
    <Sheet visible={visible} onClose={onClose} title="Discount" subtitle={`On subtotal ${money(subtotal, currency)} (before GST)`} width={420}
      footer={
        <View style={styles.footerRow}>
          {value ? <Button title="Remove" variant="ghost" icon="trash-outline" onPress={() => onApply(null)} /> : <View />}
          <Button title={amount ? `Apply −${money(amount, currency)}` : 'Apply'} onPress={apply} disabled={!!error} />
        </View>
      }>
      <Segmented value={type} onChange={(v) => setType(v)} options={[{ value: 'percent', label: 'Percent %' }, { value: 'flat', label: `Amount ${currency}` }]} />
      <Input autoFocus keyboardType="decimal-pad" value={text} onChangeText={setText} placeholder={type === 'percent' ? 'e.g. 10' : 'e.g. 50'}
        prefix={type === 'flat' ? currency : undefined} right={type === 'percent' ? <Text tone="muted" style={{ marginRight: 12 }}>%</Text> : undefined}
        error={error} onSubmitEditing={apply} />
      <View style={styles.chipRow}>
        {(type === 'percent' ? [5, 10, 15, 20, 25] : [10, 20, 50, 100]).map((v) => (
          <Chip key={v} label={type === 'percent' ? `${v}%` : money(v, currency, true)} selected={n === v} onPress={() => setText(String(v))} />
        ))}
      </View>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Customer
// ---------------------------------------------------------------------------

export function CustomerSheet({ visible, onClose, value, online, onPick }: {
  visible: boolean; onClose: () => void; value: AttachedCustomer | null; online: boolean; onPick: (c: AttachedCustomer | null) => void;
}) {
  const { colors } = useTheme();
  const customers = useData((s) => s.customers);
  const upsertCustomer = useData((s) => s.upsertCustomer);
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [remote, setRemote] = useState<Customer | null>(null);
  const [looking, setLooking] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) { setPhone(value?.phone ?? ''); setName(value?.name ?? ''); setRemote(null); }
  }, [visible, value]);

  const digits = phone.replace(/\D/g, '');
  const term = phone.trim().toLowerCase();
  const local = useMemo(() => {
    if (!term) return customers.slice(0, 6);
    return customers.filter((c) => c.phone.includes(digits || '§') || c.name.toLowerCase().includes(term)).slice(0, 8);
  }, [customers, term, digits]);
  const exact = customers.find((c) => digits.length >= 6 && c.phone.replace(/\D/g, '') === digits) ?? (remote && remote.phone.replace(/\D/g, '') === digits ? remote : null);

  // Online lookup when a full number is typed and it isn't in the offline cache
  useEffect(() => {
    if (!visible || !online || digits.length < 10 || customers.some((c) => c.phone.replace(/\D/g, '') === digits)) return undefined;
    let alive = true;
    const t = setTimeout(() => {
      setLooking(true);
      crmApi.lookup(digits)
        .then((c) => { if (alive) { setRemote(c); upsertCustomer(c); } })
        .catch(() => { /* 404 = new customer */ })
        .finally(() => { if (alive) setLooking(false); });
    }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [visible, online, digits, customers, upsertCustomer]);

  const attach = (c: Customer) => onPick({ id: c.id, name: c.name, phone: c.phone, points: c.points, tier: c.tier });
  const validPhone = PHONE_RE.test(phone.trim()) && digits.length >= 6;

  const create = async () => {
    if (!validPhone) { toast.error('Enter a valid phone number'); return; }
    const cleanName = name.trim() || 'Guest';
    if (!online) {
      onPick({ id: null, name: cleanName, phone: digits, points: 0, tier: null });
      return;
    }
    setSaving(true);
    try {
      const c = await crmApi.create({ name: cleanName, phone: digits });
      upsertCustomer(c);
      attach(c);
    } catch (e) {
      if (isOffline(e)) onPick({ id: null, name: cleanName, phone: digits, points: 0, tier: null });
      else toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Customer" subtitle="Find by phone, or add a new customer" width={480}
      footer={value ? (
        <View style={styles.footerRow}>
          <Button title="Remove customer" variant="ghost" icon="person-remove-outline" onPress={() => onPick(null)} />
          <Button title="Done" variant="secondary" onPress={onClose} />
        </View>
      ) : undefined}>
      <Input autoFocus label="Phone or name" icon="call-outline" keyboardType="default" value={phone} onChangeText={setPhone} placeholder="98765 43210"
        right={looking ? <ActivityIndicator size="small" color={colors.primary} style={{ marginRight: 12 }} /> : undefined}
        onSubmitEditing={() => { if (exact) attach(exact); }} />
      {local.length > 0 && !exact ? (
        <View style={{ gap: 2 }}>
          {local.map((c) => (
            <ListRow key={c.id} title={c.name} subtitle={`${c.phone} · ${c.points} pts · ${c.visits} visits`} onPress={() => attach(c)}
              left={<Avatar name={c.name} />} right={<Badge label={c.tier} tone={c.tier === 'Gold' ? 'accent' : c.tier === 'Silver' ? 'info' : 'neutral'} />} />
          ))}
        </View>
      ) : null}
      {exact ? (
        <ListRow title={exact.name} subtitle={`${exact.phone} · ${exact.points} points`} onPress={() => attach(exact)} left={<Avatar name={exact.name} />}
          right={<Button title="Attach" size="sm" onPress={() => attach(exact)} />} />
      ) : validPhone && !looking ? (
        <View style={{ gap: 10 }}>
          <Text variant="small" tone="muted">New customer — add a name to save them{online ? '' : ' (they will be saved when back online)'}.</Text>
          <Input label="Name" value={name} onChangeText={setName} placeholder="Customer name" onSubmitEditing={() => void create()} autoCapitalize="words" />
          <Button title="Add customer" icon="person-add-outline" onPress={() => void create()} loading={saving} />
        </View>
      ) : null}
    </Sheet>
  );
}

export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const { colors } = useTheme();
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?';
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
      <Text variant="smallStrong" color={colors.primarySoftText}>{initials}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Running (open) orders
// ---------------------------------------------------------------------------

export function RunningOrdersSheet({ visible, onClose, online, currency, onOpen }: {
  visible: boolean; onClose: () => void; online: boolean; currency: string; onOpen: (o: Order) => void;
}) {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!visible || !online) return undefined;
    let alive = true;
    setError(null);
    ordersApi.list({ status: 'open', limit: 100 })
      .then((r) => { if (alive) setOrders(r.items); })
      .catch((e) => { if (alive) setError(errorMessage(e)); });
    return () => { alive = false; };
  }, [visible, online, reload]);

  return (
    <Sheet visible={visible} onClose={onClose} title="Running bills" subtitle="Open orders waiting for payment" width={560}>
      {!online ? (
        <EmptyState icon="cloud-offline-outline" title="You're offline" message="Running bills live on the server. They'll show here when the connection is back." />
      ) : error ? (
        <EmptyState icon="alert-circle-outline" title="Couldn't load running bills" message={error} action={{ label: 'Try again', onPress: () => setReload((n) => n + 1), icon: 'refresh' }} />
      ) : orders === null ? (
        <View style={{ padding: 32 }}><ActivityIndicator /></View>
      ) : orders.length === 0 ? (
        <EmptyState icon="checkmark-done-outline" title="No running bills" message="Orders sent to the kitchen without payment show up here." />
      ) : (
        <View style={{ gap: 2 }}>
          {orders.map((o) => (
            <ListRow key={o.id} onPress={() => onOpen(o)}
              icon={o.type === 'DINE_IN' ? 'grid-outline' : o.type === 'DELIVERY' ? 'bicycle-outline' : 'bag-handle-outline'}
              title={`${o.table_label ? `Table ${o.table_label}` : ORDER_TYPE_LABEL[o.type] ?? o.type}${o.bill_label ? ` · ${o.bill_label}` : ''}${o.token_no ? ` · #${o.token_no}` : ''}`}
              subtitle={[o.customer_name, `${o.items.reduce((s, i) => s + i.quantity, 0)} items`, ago(o.created_at), o.channel !== 'POS' ? CHANNEL_LABEL[o.channel] : null].filter(Boolean).join(' · ')}
              right={<Text variant="money">{money(o.total_amount, currency)}</Text>} />
          ))}
        </View>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  variantGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  variant: { flexGrow: 1, flexBasis: 180, borderWidth: 1, padding: 16, gap: 6, minHeight: 76, justifyContent: 'center' },
  tableGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  table: { width: 104, height: 84, alignItems: 'center', justifyContent: 'center', gap: 2, padding: 8 },
  footerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
