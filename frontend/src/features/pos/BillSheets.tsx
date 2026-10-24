/**
 * Several bills on one table: bill tabs on the cart, "add to which bill?" when a table is busy,
 * bill name / guests, and merging bills.
 */
import React, { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Order, TableBill } from '@/api/types';
import { Badge, Button, Input, ListRow, Sheet, Text } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { money } from '@/lib/format';
import { isVoidItem } from '@/lib/billing';
import { QtyStepper } from './RunningBill';
import { billName, itemsLocked, kitchenCounts, kitchenProgress } from './runningBill';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

/** The bits of a bill the tabs and pickers need (an Order or a table's TableBill). */
export interface BillSummary {
  id: string;
  bill_label?: string | null;
  total_amount: number;
  guests?: number | null;
  customer_name?: string | null;
  status?: Order['status'];
  kitchen?: TableBill['kitchen'];
  items?: Order['items'];
}

// ---------------------------------------------------------------------------
// Tabs on the cart
// ---------------------------------------------------------------------------

export function BillTabs({ bills, currentId, newBill, newLabel, currency, onSwitch, onSeparate, disabled }: {
  bills: BillSummary[]; currentId: string | null; newBill: boolean; newLabel: string; currency: string;
  onSwitch: (id: string) => void; onSeparate: () => void; disabled?: boolean;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs} style={{ flexGrow: 0 }}
      keyboardShouldPersistTaps="handled">
      {bills.map((b, i) => (
        <Tab key={b.id} label={`${billName(b, i)} · ${money(b.total_amount, currency, true)}`} active={b.id === currentId && !newBill}
          dot={kitchenProgress(b.kitchen ?? (b.items ? kitchenCounts(b.items) : null))?.tone === 'success'}
          onPress={() => onSwitch(b.id)} disabled={disabled} />
      ))}
      {newBill ? <Tab label={newLabel.trim() || `Bill ${bills.length + 1}`} sub="new" active onPress={() => {}} /> : null}
      {!newBill ? <Tab label="Separate bill" icon="add" onPress={onSeparate} disabled={disabled} ghost /> : null}
    </ScrollView>
  );
}

function Tab({ label, sub, active, onPress, icon, disabled, ghost, dot }: {
  label: string; sub?: string; active?: boolean; onPress: () => void; icon?: IconName; disabled?: boolean; ghost?: boolean; dot?: boolean;
}) {
  const { colors, radius } = useTheme();
  return (
    <Pressable onPress={onPress} disabled={disabled || active} accessibilityRole="tab" accessibilityState={{ selected: !!active, disabled: !!disabled }}
      accessibilityLabel={`${label}${dot ? ', items ready to serve' : ''}`}
      style={({ hovered }: any) => [styles.tab, {
        borderRadius: radius.pill,
        borderColor: active ? colors.primary : colors.border,
        borderStyle: ghost ? 'dashed' : 'solid',
        backgroundColor: active ? colors.primary : hovered ? colors.surfaceSunken : colors.surface,
        opacity: disabled && !active ? 0.55 : 1,
      }, Platform.OS === 'web' && ({ cursor: active ? 'default' : 'pointer' } as any)]}>
      {icon ? <Ionicons name={icon} size={16} color={active ? colors.primaryText : colors.primary} /> : null}
      <Text variant="smallStrong" color={active ? colors.primaryText : ghost ? colors.primary : colors.text} numberOfLines={1}>{label}</Text>
      {sub ? <Text variant="caption" color={active ? colors.primaryText : colors.textSubtle}>{sub}</Text> : null}
      {dot ? <View style={[styles.dot, { backgroundColor: colors.success, borderColor: active ? colors.primaryText : colors.surface }]} /> : null}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Busy table: add to which bill?
// ---------------------------------------------------------------------------

export function TableBillsSheet({ visible, tableLabel, bills, newItems, currency, online, onAddTo, onSeparate, onClose }: {
  visible: boolean; tableLabel: string; bills: BillSummary[]; newItems: number; currency: string; online: boolean;
  onAddTo: (billId: string) => void; onSeparate: (details: { label: string; guests: number | null }) => void; onClose: () => void;
}) {
  const [label, setLabel] = useState('');
  const [guests, setGuests] = useState(0);
  useEffect(() => { if (visible) { setLabel(''); setGuests(0); } }, [visible]);
  return (
    <Sheet visible={visible} onClose={onClose} width={520} title={`Table ${tableLabel} has ${bills.length === 1 ? 'a running bill' : `${bills.length} running bills`}`}
      subtitle={newItems ? `Where should the ${newItems} new item${newItems === 1 ? '' : 's'} go?` : 'Add to a bill, or start a separate one for another party'}>
      {!online ? <Badge label="Offline — running bills need internet" tone="warning" icon="cloud-offline-outline" /> : null}
      <View style={{ gap: 2 }}>
        {bills.map((b, i) => {
          const progress = kitchenProgress(b.kitchen ?? (b.items ? kitchenCounts(b.items) : null));
          return (
            <ListRow key={b.id} icon="receipt-outline" title={`Add to ${billName(b, i)}`}
              subtitle={[money(b.total_amount, currency), b.customer_name, b.guests ? `${b.guests} guests` : null, progress?.label].filter(Boolean).join(' · ')}
              onPress={online ? () => onAddTo(b.id) : undefined} />
          );
        })}
      </View>
      <View style={styles.separate}>
        <Text variant="bodyStrong">Start a separate bill</Text>
        <Text variant="small" tone="muted">For another party at this table — they get their own bill and pay separately.</Text>
        <View style={styles.separateRow}>
          <Input value={label} onChangeText={setLabel} maxLength={40} placeholder={`Name, e.g. Rahul (or Bill ${bills.length + 1})`} icon="person-outline"
            containerStyle={{ flex: 1, minWidth: 180 }} />
          <GuestsField value={guests} onChange={setGuests} />
        </View>
        <Button title="Start separate bill" icon="add" onPress={() => onSeparate({ label: label.trim(), guests: guests || null })} disabled={!online}
          accessibilityLabel="Start a separate bill on this table" />
      </View>
    </Sheet>
  );
}

function GuestsField({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }} accessibilityLabel="Guests">
      <Ionicons name="people-outline" size={18} color={colors.textMuted} />
      <QtyStepper value={value} min={0} max={500} onChange={onChange} label="guest" />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Bill name + guests
// ---------------------------------------------------------------------------

export function BillDetailsSheet({ visible, title, label, guests, placeholder, onSave, onClose }: {
  visible: boolean; title: string; label: string; guests: number | null; placeholder: string;
  onSave: (details: { label: string; guests: number | null }) => Promise<void> | void; onClose: () => void;
}) {
  const [name, setName] = useState(label);
  const [count, setCount] = useState(guests ?? 0);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (visible) { setName(label); setCount(guests ?? 0); } }, [visible, label, guests]);
  const save = async () => {
    setSaving(true);
    try {
      await onSave({ label: name.trim(), guests: count || null });
    } finally {
      setSaving(false);
    }
  };
  return (
    <Sheet visible={visible} onClose={onClose} title={title} subtitle="Tells bills on a shared table apart" width={440}
      footer={
        <View style={styles.footer}>
          <Button title="Cancel" variant="secondary" onPress={onClose} disabled={saving} />
          <Button title="Save" icon="checkmark" onPress={() => void save()} loading={saving} disabled={saving} />
        </View>
      }>
      <Input label="Bill name" value={name} onChangeText={setName} maxLength={40} placeholder={placeholder} icon="person-outline" autoFocus
        onSubmitEditing={() => void save()} />
      <View style={styles.guestsRow}>
        <View style={{ flex: 1 }}>
          <Text variant="bodyStrong">Guests</Text>
          <Text variant="small" tone="muted">{count ? `${count} at this bill` : 'Not set'}</Text>
        </View>
        <QtyStepper value={count} min={0} max={500} onChange={setCount} label="guest" />
      </View>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Merge bills
// ---------------------------------------------------------------------------

export function MergeBillsSheet({ visible, current, currentName, bills, currency, online, onMerge, onClose }: {
  visible: boolean; current: Order | null; currentName: string; bills: Order[]; currency: string; online: boolean;
  onMerge: (sourceId: string) => Promise<void>; onClose: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const others = bills.filter((b) => b.id !== current?.id);
  const merge = async (id: string) => {
    setBusy(id);
    try { await onMerge(id); } finally { setBusy(null); }
  };
  return (
    <Sheet visible={visible} onClose={onClose} width={500} title={`Merge into ${currentName}`}
      subtitle="The other bill's items move onto this one (tables joined, one person pays). The emptied bill closes as merged.">
      {!online ? <Badge label="Needs internet" tone="warning" icon="cloud-offline-outline" /> : null}
      {current && itemsLocked(current) ? <Badge label="This bill has a payment — bills with payments can't be merged" tone="warning" icon="lock-closed-outline" /> : null}
      {others.length === 0 ? <Text tone="muted">There is no other open bill on this table.</Text> : null}
      <View style={{ gap: 6 }}>
        {others.map((b) => {
          const locked = itemsLocked(b);
          const n = b.items.filter((i) => !isVoidItem(i)).reduce((s, i) => s + i.quantity, 0);
          return (
            <View key={b.id} style={styles.mergeRow}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text variant="bodyStrong" numberOfLines={1}>{billName(b, bills.indexOf(b))}</Text>
                <Text variant="small" tone="muted" numberOfLines={1}>{money(b.total_amount, currency)} · {n} item{n === 1 ? '' : 's'}{locked ? ' · has a payment' : ''}</Text>
              </View>
              <Button title="Merge" icon="git-merge-outline" variant="secondary" onPress={() => void merge(b.id)} loading={busy === b.id}
                disabled={!online || !!busy || locked || !current || itemsLocked(current)} accessibilityLabel={`Merge ${billName(b, bills.indexOf(b))} into ${currentName}`} />
            </View>
          );
        })}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  tabs: { gap: 6, paddingVertical: 2, alignItems: 'center' },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: 14, borderWidth: 1, maxWidth: 240 },
  dot: { width: 10, height: 10, borderRadius: 5, borderWidth: 2 },
  separate: { gap: 8, paddingTop: 8 },
  separateRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  footer: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  guestsRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  mergeRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56 },
});
