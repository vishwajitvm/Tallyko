/**
 * The running bill's "Already on the bill" list with a checkbox per item, and the action bar for the selection:
 * mark preparing / ready / served, cancel (all or part of a line), on the house, move to another bill, repeat.
 *
 * Floor situations it is built for:
 * - "Two more rotis": select the roti line → Repeat → a new KOT for just those.
 * - 4 items, 2 ready and 2 cooking: each line shows its own kitchen status; tick the ready ones → Served.
 * - Owner alone (no kitchen screen): tick and mark Ready / Served from the bill itself.
 * - Two parties at one table: tick their items → Move → New bill (or the other bill on the table).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Order, OrderItem } from '@/api/types';
import { floorApi, type ItemStatus } from '@/api/floor';
import { ordersApi } from '@/api/endpoints';
import { errorMessage } from '@/api/client';
import {
  ActionMenu, Badge, Button, Checkbox, Chip, IconButton, Input, SelectionBar, Sheet, StatusPill, SwitchRow, Text, toast, type SelectionAction,
} from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { useAuth, can } from '@/store/auth';
import { useAccessInfo, useCan } from '@/store/access';
import { usePrefs } from '@/store/prefs';
import { isCompItem, isFreeItem, isVoidItem, kotFromOrder, printErrorMessage, printKitchenTicket } from '@/lib/billing';
import { money } from '@/lib/format';
import {
  KITCHEN_FLOW, KITCHEN_META, billName, describeSelection, isSent, itemsLocked, nextKitchenStatus, selectableItems, toItemQty, type Selection,
} from './runningBill';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

/** Permission from the staff member's role; before /access/me has loaded, the built-in role rules decide. */
function usePermission(permission: string, fallback: boolean): boolean {
  const info = useAccessInfo();
  const allowed = useCan(permission);
  return info ? allowed : fallback;
}

export function useFloorPermissions() {
  const role = useAuth((s) => s.session?.role ?? null);
  return {
    status: usePermission('kitchen.update', !!role),
    create: usePermission('orders.create', can(role, 'order')),
    voidSent: usePermission('orders.void_item', can(role, 'manage')),
    comp: usePermission('orders.discount', can(role, 'bill')),
  };
}

// ---------------------------------------------------------------------------
// Item list
// ---------------------------------------------------------------------------

export function RunningItems({ items, selected, onToggle, onToggleAll, currency, selectable }: {
  items: OrderItem[]; selected: ReadonlySet<string>; onToggle: (id: string) => void; onToggleAll: (all: boolean) => void;
  currency: string; selectable: boolean;
}) {
  const { colors } = useTheme();
  const live = selectableItems(items);
  const all = live.length > 0 && live.every((i) => selected.has(i.id));
  const some = !all && live.some((i) => selected.has(i.id));
  return (
    <View style={{ gap: 2 }}>
      <View style={styles.head}>
        <Ionicons name="checkmark-done" size={14} color={colors.textSubtle} />
        <Text variant="caption" tone="subtle" style={{ textTransform: 'uppercase', flex: 1 }}>Already on the bill</Text>
        {selectable && live.length ? (
          <Pressable onPress={() => onToggleAll(!all)} accessibilityRole="checkbox" accessibilityState={{ checked: all ? true : some ? 'mixed' : false }}
            accessibilityLabel="Select all items" hitSlop={6}
            style={({ hovered }: any) => [styles.selectAll, hovered && { backgroundColor: colors.surfaceSunken }, Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}>
            <Text variant="smallStrong" tone="muted">{all ? 'Clear' : 'Select all'}</Text>
            <View pointerEvents="none"><Checkbox checked={all} indeterminate={some} accessibilityLabel="Select all items" /></View>
          </Pressable>
        ) : null}
      </View>
      {items.map((item) => (
        <ItemRow key={item.id} item={item} currency={currency} checked={selected.has(item.id)} selectable={selectable}
          onToggle={() => onToggle(item.id)} />
      ))}
    </View>
  );
}

function ItemRow({ item, currency, checked, selectable, onToggle }: {
  item: OrderItem; currency: string; checked: boolean; selectable: boolean; onToggle: () => void;
}) {
  const { colors, radius } = useTheme();
  const voided = isVoidItem(item);
  const free = isFreeItem(item);
  const comp = isCompItem(item);
  const status = item.kitchen_status && !voided ? KITCHEN_META[item.kitchen_status] : null;
  const canTick = selectable && !voided;
  const name = `${item.name}${item.variant_name ? ` (${item.variant_name})` : ''}`;
  const label = `${item.quantity} × ${name}${voided ? ', cancelled' : ''}${comp ? ', on the house' : ''}${status ? `, ${status.label}` : ''}`;

  const body = (
    <>
      {selectable ? (
        <View style={styles.box} pointerEvents="none">
          {voided ? <Ionicons name="close" size={18} color={colors.danger} /> : <Checkbox checked={checked} accessibilityLabel={name} />}
        </View>
      ) : null}
      <Text variant="smallStrong" tone={voided ? 'danger' : 'muted'} style={[styles.qty, voided && styles.strike]}>{item.quantity}×</Text>
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <Text variant="small" tone={voided ? 'danger' : 'default'} numberOfLines={2} style={voided ? styles.strike : undefined}>{name}</Text>
        <View style={styles.meta}>
          {voided ? <StatusPill status="void" label="Cancelled" /> : null}
          {status && item.kitchen_status ? <StatusPill status={item.kitchen_status} /> : null}
          {comp ? <Badge label="On the house" tone="success" icon="heart-outline" /> : null}
          {free && !comp ? <Badge label="Free" tone="success" icon="gift-outline" /> : null}
        </View>
        {voided && item.void_reason ? <Text variant="caption" tone="subtle" numberOfLines={1}>{item.void_reason}</Text> : null}
        {comp && item.comp_reason ? <Text variant="caption" tone="success" numberOfLines={2}>{item.comp_reason}</Text> : null}
        {item.notes && !free ? <Text variant="caption" tone="subtle" numberOfLines={2}>{item.notes}</Text> : null}
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        {voided ? <Text variant="small" tone="subtle" style={[styles.num, styles.strike]}>{money(item.unit_price * item.quantity, currency)}</Text>
          : comp ? (
            <>
              <Text variant="small" tone="success" style={styles.num}>{money(0, currency)}</Text>
              {item.comp_value ? <Text variant="caption" tone="subtle" style={[styles.num, styles.strike]}>{money(item.comp_value, currency)}</Text> : null}
            </>
          ) : free ? <Text variant="small" tone="success" style={styles.num}>{money(0, currency)}</Text>
          : <Text variant="small" tone="muted" style={styles.num}>{money(item.line_total, currency)}</Text>}
      </View>
    </>
  );

  if (!canTick) {
    return <View style={[styles.row, { borderBottomColor: colors.divider }, voided && { opacity: 0.85 }]} accessibilityLabel={label}>{body}</View>;
  }
  return (
    <Pressable onPress={onToggle} accessibilityRole="checkbox" accessibilityState={{ checked }} accessibilityLabel={label}
      style={({ hovered }: any) => [styles.row, {
        borderBottomColor: colors.divider, borderRadius: radius.sm,
        backgroundColor: checked ? colors.selectedRow : hovered ? colors.surfaceAlt : 'transparent',
      }, Platform.OS === 'web' && ({ cursor: 'pointer', userSelect: 'none' } as any)]}>
      {body}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Selection bar (docs/20 §1.1): the shared SelectionBar right under the ticked rows. The next kitchen step, Cancel
// and Repeat stay one tap even in the narrow cart (`minVisible`); the rest opens in its anchored "More" menu.
// ---------------------------------------------------------------------------

type SheetMode = 'void' | 'comp' | 'move' | 'repeat';

export interface BarAction {
  key: string; label: string; icon: IconName; disabled: boolean; disabledReason?: string; description?: string;
  variant?: 'primary' | 'outline' | 'dangerOutline';
}

/** Buttons the bar shows for a selection: the common ones in view (`main`), the rest in the menu (`more`). Pure, for tests. */
export function selectionActions(input: {
  sel: Selection; locked: boolean; online: boolean; busy: boolean;
  perms: { status: boolean; create: boolean; voidSent: boolean; comp: boolean };
}): { main: BarAction[]; more: BarAction[] } {
  const { sel, locked, online, busy, perms } = input;
  const next = nextKitchenStatus(sel.kitchen);
  const offReason = !online ? 'Needs internet' : busy ? 'Saving…' : undefined;
  const lockReason = locked ? 'A payment was taken on this bill' : undefined;
  const main: BarAction[] = [];
  const more: BarAction[] = [];
  if (perms.status && sel.kitchen.length) {
    for (const st of KITCHEN_FLOW) {
      if (st === 'pending') continue;
      const done = sel.kitchen.every((i) => i.kitchen_status === st);
      const action: BarAction = {
        key: st, label: KITCHEN_META[st].label, icon: KITCHEN_META[st].icon as IconName,
        disabled: !!offReason || done, disabledReason: offReason ?? (done ? `Already ${KITCHEN_META[st].label.toLowerCase()}` : undefined),
        description: `Mark ${KITCHEN_META[st].label.toLowerCase()}`,
      };
      if (st === next) main.push({ ...action, variant: 'primary' });
      else more.push(action);
    }
  }
  if (perms.create) {
    const sentBlocked = sel.anySent && !perms.voidSent;
    main.push({
      key: 'void', label: 'Cancel', icon: 'close-circle-outline', variant: 'dangerOutline',
      disabled: !!offReason || locked || !sel.voidable.length || sentBlocked,
      disabledReason: offReason ?? lockReason ?? (!sel.voidable.length ? 'Free items follow their offer' : sentBlocked ? 'Items in the kitchen: a manager must cancel them' : undefined),
    });
    main.push({
      key: 'repeat', label: 'Repeat', icon: 'repeat', variant: 'outline',
      disabled: !!offReason || !sel.repeatable.length, disabledReason: offReason ?? (!sel.repeatable.length ? 'Free items can\'t be repeated' : undefined),
      description: 'Order again as a new KOT',
    });
  }
  if (perms.comp) {
    more.push({
      key: 'comp', label: 'On the house', icon: 'heart-outline', description: 'Free on this bill, value kept for reports',
      disabled: !!offReason || locked || !sel.compable.length, disabledReason: offReason ?? lockReason ?? (!sel.compable.length ? 'Already free' : undefined),
    });
  }
  if (perms.create) {
    more.push({
      key: 'move', label: 'Move to another bill', icon: 'git-branch-outline', description: 'Split: to another or a new bill',
      disabled: !!offReason || locked || !sel.movable.length, disabledReason: offReason ?? lockReason ?? (!sel.movable.length ? 'Free items follow their offer' : undefined),
    });
  }
  return { main, more };
}

export function ItemSelectionBar({ order, selected, online, currency, bills, onClear, onOrder, onMoved }: {
  order: Order; selected: ReadonlySet<string>; online: boolean; currency: string;
  /** Other open bills on the same table (move targets). */
  bills: Order[];
  onClear: () => void;
  onOrder: (order: Order, message?: string) => void;
  onMoved: (result: { source: Order; target: Order }) => void;
}) {
  const { colors } = useTheme();
  const perms = useFloorPermissions();
  const [busy, setBusy] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetMode | null>(null);
  const sel = useMemo(() => describeSelection(order.items, selected), [order.items, selected]);
  // The sheet keeps working on the items it opened with, even after the selection is cleared
  const [sheetSel, setSheetSel] = useState<Selection | null>(null);
  const locked = itemsLocked(order);

  /** Optimistic: the bill shows the new status at once; the server's answer replaces it (or the change is rolled back). */
  const setStatus = async (status: ItemStatus) => {
    const ids = new Set(sel.kitchen.map((i) => i.id));
    if (!ids.size) return;
    const count = sel.kitchen.reduce((s, i) => s + i.quantity, 0);
    const before = order;
    onOrder({ ...order, items: order.items.map((i) => (ids.has(i.id) ? { ...i, kitchen_status: status } : i)) });
    onClear();
    setBusy(status);
    try {
      const updated = await floorApi.setItemsStatus(order.id, [...ids], status);
      onOrder(updated, `${count} item${count === 1 ? '' : 's'} marked ${KITCHEN_META[status].label.toLowerCase()}`);
    } catch (e) {
      toast.error(errorMessage(e));
      try { onOrder(await ordersApi.get(order.id)); } catch { onOrder(before); }
    } finally {
      setBusy(null);
    }
  };

  const sheetView = (
    <ItemsSheet mode={sheet} order={order} sel={sheetSel ?? sel} bills={bills} currency={currency} online={online} canVoidSent={perms.voidSent}
      onClose={() => { setSheet(null); setSheetSel(null); }}
      onDone={(updated, message) => { setSheet(null); setSheetSel(null); onClear(); onOrder(updated, message); }}
      onMoved={(r) => { setSheet(null); setSheetSel(null); onMoved(r); }} />
  );
  if (!sel.items.length) return sheet ? sheetView : null;

  const { main, more } = selectionActions({ sel, locked, online, busy: !!busy, perms });
  const run = (key: string) => {
    if ((KITCHEN_FLOW as string[]).includes(key)) void setStatus(key as ItemStatus);
    else { setSheetSel(sel); setSheet(key as SheetMode); }
  };
  const hint = !online ? 'Needs internet — these actions work again when you are back online.'
    : locked ? 'A payment was taken on this bill, so items can\'t be cancelled, given free or moved.'
    : !sel.kitchen.length && perms.status ? 'These items don\'t go through the kitchen.'
    : null;
  // `main` (next kitchen step, Cancel, Repeat) are always buttons; `more` goes under the bar's "More"
  const actions: SelectionAction[] = [...main, ...more].map((a) => ({
    key: a.key, label: a.label, icon: a.icon, variant: a.variant ?? (main.includes(a) ? 'outline' : undefined), description: a.description,
    disabled: a.disabled, disabledReason: a.disabledReason, loading: busy === a.key, onPress: () => run(a.key),
  }));

  return (
    <View style={styles.bar} testID="pos-selection-bar">
      <SelectionBar count={sel.quantity} onClear={onClear} actions={actions} minVisible={main.length} maxVisible={Math.max(1, main.length)}
        label={(n) => `${n} item${n === 1 ? '' : 's'} selected`} />
      {hint ? (
        <View style={styles.hint}>
          <Ionicons name={!online ? 'cloud-offline-outline' : 'information-circle-outline'} size={14} color={colors.textMuted} />
          <Text variant="caption" tone="muted" style={{ flex: 1 }} numberOfLines={2}>{hint}</Text>
        </View>
      ) : null}
      {sheetView}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Cancel / on the house / move / repeat
// ---------------------------------------------------------------------------

const VOID_REASONS = ['Customer changed mind', 'Ordered by mistake', 'Took too long', 'Out of stock'];
const COMP_REASONS = ['Regular customer', 'Complaint / delay', 'Birthday', 'Owner\'s guest'];

function ItemsSheet({ mode, order, sel, bills, currency, online, canVoidSent, onClose, onDone, onMoved }: {
  mode: SheetMode | null; order: Order; sel: Selection; bills: Order[]; currency: string; online: boolean; canVoidSent: boolean;
  onClose: () => void; onDone: (o: Order, message: string) => void; onMoved: (r: { source: Order; target: Order }) => void;
}) {
  const lines = mode === 'void' ? sel.voidable : mode === 'comp' ? sel.compable : mode === 'move' ? sel.movable : sel.repeatable;
  const [qty, setQty] = useState<Record<string, number>>({});
  const [reason, setReason] = useState('');
  const [waste, setWaste] = useState(false);
  const [target, setTarget] = useState<string>('new');
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const others = bills.filter((b) => b.id !== order.id && b.status === 'open' && !itemsLocked(b));

  useEffect(() => {
    if (!mode) return;
    setQty(Object.fromEntries(lines.map((i) => [i.id, i.quantity])));
    setReason('');
    setWaste(false);
    setLabel('');
    setTarget('new');
    // reset whenever the sheet opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const chosen = toItemQty(lines, qty);
  const count = chosen.reduce((s, c) => s + (c.quantity ?? lines.find((l) => l.id === c.item_id)?.quantity ?? 0), 0);
  const sentChosen = lines.some((l) => isSent(l) && chosen.some((c) => c.item_id === l.id));
  const needReason = mode === 'comp' || (mode === 'void' && sentChosen);
  const reasonOk = !needReason || reason.trim().length >= 2;
  const blocked = mode === 'void' && sentChosen && !canVoidSent;

  const submit = async () => {
    if (!mode || !chosen.length || !reasonOk || blocked || !online) return;
    setSaving(true);
    try {
      if (mode === 'void') {
        const updated = await floorApi.voidItems(order.id, { items: chosen, reason: reason.trim() || null, waste: sentChosen && waste });
        if (updated.warning) toast.warning(updated.warning);
        onDone(updated, `${count} item(s) cancelled${sentChosen ? ' — the kitchen sees it struck out' : ''}`);
      } else if (mode === 'comp') {
        const updated = await floorApi.compItems(order.id, { items: chosen, reason: reason.trim() });
        onDone(updated, `${count} item(s) on the house`);
      } else if (mode === 'move') {
        const result = await floorApi.moveItems(order.id, target === 'new'
          ? { items: chosen, new_bill_label: label.trim() || null }
          : { items: chosen, target_order_id: target });
        onMoved(result);
      } else {
        const before = new Set(order.items.map((i) => i.id));
        const input = lines.filter((l) => (qty[l.id] ?? 0) > 0).map((l) => ({
          product_id: l.product_id, variant_id: l.variant_id, quantity: Math.floor(qty[l.id]!), notes: l.notes && !isFreeItem(l) ? l.notes : null,
        }));
        const updated = await ordersApi.addItems(order.id, input, true);
        const added = updated.items.filter((i) => !before.has(i.id));
        if (usePrefs.getState().autoPrintKot && added.some((i) => i.sent_to_kitchen)) {
          printKitchenTicket(kotFromOrder({ ...updated, table_label: updated.table_label ?? order.table_label, items: added.filter((i) => i.sent_to_kitchen) }))
            .catch((e) => toast.error(printErrorMessage(e)));
        }
        onDone(updated, `${count} more sent to the kitchen`);
      }
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const meta: Record<SheetMode, { title: string; subtitle: string; action: string; icon: IconName; variant: 'danger' | 'primary' | 'success' }> = {
    void: { title: 'Cancel items', subtitle: 'Unsent items are simply removed. Items the kitchen has stay on the bill as cancelled and are never charged.',
      action: `Cancel ${count} item${count === 1 ? '' : 's'}`, icon: 'close-circle-outline', variant: 'danger' },
    comp: { title: 'On the house', subtitle: 'These items cost nothing on this bill. Their value is kept for reports.',
      action: `Make ${count} item${count === 1 ? '' : 's'} free`, icon: 'heart-outline', variant: 'success' },
    move: { title: 'Move to another bill', subtitle: 'Split the bill: the items and their kitchen status move together.',
      action: `Move ${count} item${count === 1 ? '' : 's'}`, icon: 'git-branch-outline', variant: 'primary' },
    repeat: { title: 'Repeat items', subtitle: 'Orders the same items again as a new kitchen ticket (KOT).',
      action: `Send ${count} to kitchen`, icon: 'restaurant-outline', variant: 'primary' },
  };
  const m = mode ? meta[mode] : null;

  return (
    <Sheet visible={!!mode} onClose={onClose} title={m?.title} subtitle={m?.subtitle} width={540}
      footer={m ? (
        <View style={styles.footer}>
          <Button title="Back" variant="secondary" onPress={onClose} disabled={saving} />
          <Button title={online ? m.action : 'Needs internet'} icon={online ? m.icon : 'cloud-offline-outline'} variant={m.variant} onPress={() => void submit()}
            loading={saving} disabled={!online || saving || !chosen.length || !reasonOk || blocked} />
        </View>
      ) : undefined}>
      <View style={{ gap: 4 }}>
        {lines.map((l) => (
          <View key={l.id} style={styles.qtyRow}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text variant="bodyStrong" numberOfLines={2}>{l.name}{l.variant_name ? <Text tone="muted"> · {l.variant_name}</Text> : null}</Text>
              <Text variant="caption" tone="subtle" numberOfLines={1}>
                {[`${l.quantity} on the bill`, l.kitchen_status ? KITCHEN_META[l.kitchen_status].label : 'Not sent to kitchen', money(l.unit_price, currency) + ' each'].join(' · ')}
              </Text>
            </View>
            <QtyStepper value={qty[l.id] ?? 0} min={0} max={mode === 'repeat' ? 99 : l.quantity} label={l.name}
              onChange={(n) => setQty((q) => ({ ...q, [l.id]: n }))} />
          </View>
        ))}
      </View>

      {mode === 'void' && blocked ? (
        <Badge label="Some items are already in the kitchen — ask a manager to cancel them" tone="warning" icon="lock-closed-outline" />
      ) : null}

      {needReason ? (
        <View style={{ gap: 8 }}>
          <Input label="Reason" required value={reason} onChangeText={setReason} maxLength={200}
            placeholder={mode === 'comp' ? 'e.g. Regular customer' : 'e.g. Customer changed mind'} />
          <View style={styles.chips}>
            {(mode === 'comp' ? COMP_REASONS : VOID_REASONS).map((r) => <Chip key={r} label={r} selected={reason === r} onPress={() => setReason(r)} />)}
          </View>
        </View>
      ) : null}

      {mode === 'void' && sentChosen ? (
        <SwitchRow title="Already made — count as wastage" subtitle="Takes it out of stock (for items whose stock you track)." value={waste} onValueChange={setWaste} />
      ) : null}

      {mode === 'move' ? (
        <View style={{ gap: 6 }}>
          <Text variant="caption" tone="subtle" style={{ textTransform: 'uppercase' }}>Move to</Text>
          <TargetRow selected={target === 'new'} onPress={() => setTarget('new')} icon="add-circle-outline" title="A new bill"
            subtitle={order.table_label ? `Separate bill on table ${order.table_label}` : 'Separate bill'} />
          {target === 'new' ? (
            <Input value={label} onChangeText={setLabel} maxLength={40} placeholder="Name for the new bill (optional), e.g. Rahul" icon="person-outline" />
          ) : null}
          {others.map((b) => (
            <TargetRow key={b.id} selected={target === b.id} onPress={() => setTarget(b.id)} icon="receipt-outline"
              title={billName(b, bills.indexOf(b))} subtitle={`${money(b.total_amount, currency)} · ${b.items.filter((i) => !isVoidItem(i)).reduce((s, i) => s + i.quantity, 0)} items`} />
          ))}
        </View>
      ) : null}
    </Sheet>
  );
}

function TargetRow({ selected, onPress, icon, title, subtitle }: { selected: boolean; onPress: () => void; icon: IconName; title: string; subtitle: string }) {
  const { colors, radius } = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="radio" accessibilityState={{ checked: selected }} accessibilityLabel={`${title}, ${subtitle}`}
      style={({ hovered }: any) => [styles.target, {
        borderRadius: radius.md, borderColor: selected ? colors.primary : colors.border,
        backgroundColor: selected ? colors.primarySoft : hovered ? colors.surfaceAlt : colors.surface,
      }, Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}>
      <Ionicons name={icon} size={20} color={selected ? colors.primary : colors.textMuted} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="bodyStrong" numberOfLines={1}>{title}</Text>
        <Text variant="caption" tone="muted" numberOfLines={1}>{subtitle}</Text>
      </View>
      <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={20} color={selected ? colors.primary : colors.textSubtle} />
    </Pressable>
  );
}

export function QtyStepper({ value, min, max, onChange, label }: { value: number; min: number; max: number; onChange: (n: number) => void; label: string }) {
  const { colors, radius } = useTheme();
  const btn = (icon: IconName, delta: number, a11y: string) => {
    const disabled = delta < 0 ? value <= min : value >= max;
    return (
      <Pressable onPress={() => onChange(Math.max(min, Math.min(max, value + delta)))} disabled={disabled} accessibilityRole="button" accessibilityLabel={a11y}
        style={({ hovered }: any) => [styles.stepBtn, hovered && !disabled && { backgroundColor: colors.surfaceSunken }, Platform.OS === 'web' && ({ cursor: disabled ? 'not-allowed' : 'pointer' } as any)]}>
        <Ionicons name={icon} size={18} color={disabled ? colors.border : colors.text} />
      </Pressable>
    );
  };
  return (
    <View style={[styles.stepper, { borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface }]}>
      {btn('remove', -1, `One less ${label}`)}
      <View style={styles.stepValue}><Text variant="bodyStrong" style={styles.num}>{value}</Text></View>
      {btn('add', 1, `One more ${label}`)}
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 6, minHeight: 36 },
  selectAll: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, minHeight: 44, borderRadius: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingRight: 6, paddingVertical: 6, borderBottomWidth: 1, minHeight: 48 },
  box: { width: 36, minHeight: 36, alignItems: 'center', justifyContent: 'center' },
  qty: { width: 28 },
  meta: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  strike: { textDecorationLine: 'line-through' },
  num: { fontVariant: ['tabular-nums'] },
  bar: { marginHorizontal: 8, marginBottom: 8, gap: 6 },
  hint: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, paddingHorizontal: 4 },
  footer: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap' },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  target: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, minHeight: 56 },
  stepper: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, overflow: 'hidden' },
  stepBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  stepValue: { minWidth: 32, height: 44, alignItems: 'center', justifyContent: 'center' },
});
