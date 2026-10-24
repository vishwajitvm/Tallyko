/**
 * Floor view (docs/20_High_Volume_UX.md): compact tiles for 60+ tables with status colour, running time
 * (amber / red after the business's Floor alert times, 45 / 75 min by default), bill amount, guests, ready-to-serve count, UPI-to-confirm and the waiter.
 * Tap = open in Billing; long-press / right-click (via the menu's `menuRef`) or ⋯ = anchored ActionMenu (move, merge, print, QR, waiter…).
 * Refreshes every 8 s while visible.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import {
  ActionMenu, Button, Chip, EmptyState, ErrorState, FilterBar, IconButton, Screen, Sheet, Skeleton, Text, confirm, statusToneColors, toast,
  type ActionMenuHandle, type ActionMenuItem, type StatusTone,
} from '@/components/ui';
import { QrCode } from '@/components/QrCode';
import { ordersApi, tablesApi } from '@/api/endpoints';
import { ApiError, errorMessage } from '@/api/client';
import type { TableBill, TableInfo } from '@/api/types';
import { floorApi, opsApi } from '@/api/floor';
import { useAuth, can } from '@/store/auth';
import { useData } from '@/store/data';
import { useBadges } from '@/store/badges';
import { printBill, printErrorMessage } from '@/lib/billing';
import { money } from '@/lib/format';
import { ActionMenu as ListSheet, ChipRow, Grid, Notice, tableOrderUrl, type MenuAction } from './common';
import { TableForm } from './TableForm';
import { printTableQrs } from './tableQr';
import { billName, kitchenProgress } from '../pos/runningBill';
import {
  NO_SECTION, ageTone, billsOf, formatAge, initials, matchesTableFilter, sectionCounts, summarizeTable, tableFilterCounts,
  type AgeThresholds, type TableFilter, type TableState, type TableSummary,
} from './floorLogic';
import { useFloorAges } from './useFloorAges';
import { useDevicePref, useLivePoll, useNow } from '@/hooks/live';
import { AgeChip, GroupTitle, LiveStatus, WaiterAvatar, useContextMenu } from './parts';

const POLL_MS = 8_000;
const STATE_TONE: Record<TableState, StatusTone> = { free: 'neutral', new: 'pending', occupied: 'progress', ready: 'ready', payment: 'waiting' };
const STATE_LABEL: Record<TableState, string> = { free: 'Free', new: 'New QR order', occupied: 'Running', ready: 'Food ready', payment: 'Waiting payment' };

type Size = 'compact' | 'large';

export default function TablesScreen() {
  const { colors } = useTheme();
  const { isPhone, isDesktop } = useLayout();
  const role = useAuth((s) => s.session?.role ?? null);
  const tenantId = useAuth((s) => s.session?.tenantId ?? '');
  const me = useAuth((s) => s.session);
  const settings = useData((s) => s.settings);
  const businessName = settings?.business_name ?? me?.businessName ?? 'Our restaurant';
  const sym = settings?.currency_symbol ?? '₹';
  const now = useNow(15_000);
  const manager = can(role, 'manage');
  const canOrder = can(role, 'order');

  const poll = useLivePoll(() => tablesApi.list(), [], POLL_MS);
  const { data, error, loading, reload, silentReload } = poll;

  const ages = useFloorAges();
  // Waiter names come with GET /tables (bill waiter_name, table assigned_staff_name), so every role sees them.
  const nameOf = useCallback((s: TableSummary) => {
    if (!s.waiterId) return null;
    if (me?.userId === s.waiterId && me.fullName) return me.fullName;
    return s.waiterName;
  }, [me?.userId, me?.fullName]);

  const [filter, setFilter] = useState<TableFilter>('all');
  const [section, setSection] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [size, setSize] = useDevicePref<Size>('tables.size', 'compact');
  const [moveFrom, setMoveFrom] = useState<{ table: TableInfo; mode: 'move' | 'merge' } | null>(null);
  const [waiterFor, setWaiterFor] = useState<TableInfo | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<TableInfo | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  // The "Assign waiter" picker (managers) loads the staff list the first time it opens
  const [staff, setStaff] = useState<StaffOption[] | 'denied' | null>(null);
  useEffect(() => {
    if (!waiterFor || staff) return;
    opsApi.staff().then((list) => setStaff(list.filter((x) => x.is_active)), () => setStaff('denied'));
  }, [waiterFor, staff]);
  const staffList = Array.isArray(staff) ? staff : null;

  const tables = data ?? [];
  const summaries = useMemo(() => tables.map((t) => summarizeTable(t, now)), [tables, now]);
  const byId = useMemo(() => new Map(tables.map((t, i) => [t.id, summaries[i]!])), [tables, summaries]);
  const sections = useMemo(() => sectionCounts(tables, (i) => summaries[i]!.bills.length > 0), [tables, summaries]);
  const realSections = sections.filter((s) => s.name !== NO_SECTION || sections.length > 1);
  const inSection = useMemo(
    () => tables.map((t, i) => ({ t, s: summaries[i]! })).filter(({ t }) => !section || (t.section?.trim() || NO_SECTION) === section),
    [tables, summaries, section],
  );
  const counts = useMemo(() => tableFilterCounts(inSection.map((x) => x.s)), [inSection]);
  const q = query.trim().toLowerCase();
  const visible = useMemo(() => inSection.filter(({ t, s }) => matchesTableFilter(s, filter)
    && (!q || t.table_number.toLowerCase().includes(q) || s.bills.some((b) => (b.customer_name ?? '').toLowerCase().includes(q) || b.code.toLowerCase().includes(q)))),
  [inSection, filter, q]);
  const groups = useMemo(() => {
    const map = new Map<string, { t: TableInfo; s: TableSummary }[]>();
    for (const row of visible) {
      const key = row.t.section?.trim() || NO_SECTION;
      map.set(key, [...(map.get(key) ?? []), row]);
    }
    return Array.from(map.entries());
  }, [visible]);

  const occupied = summaries.filter((s) => s.bills.length > 0);
  const runningTotal = occupied.reduce((a, s) => a + s.total, 0);
  const readyLines = summaries.reduce((a, s) => a + s.ready, 0);

  const refreshAll = useCallback(() => { void silentReload(); void useBadges.getState().refresh(); }, [silentReload]);

  const openBill = useCallback((b: TableBill) => {
    if (b.status === 'placed') router.push('/online');
    else router.push({ pathname: '/pos', params: { order: b.id } });
  }, []);

  /** One tap: a single bill opens straight away; several bills let Billing ask which one; a free table starts a bill. */
  const open = useCallback((t: TableInfo) => {
    if (!canOrder) { toast.info('Your role can view tables but not take orders'); return; }
    const bills = billsOf(t);
    if (bills.length === 1) openBill(bills[0]!);
    else router.push({ pathname: '/pos', params: { table: t.id } });
  }, [canOrder, openBill]);

  const printTableBill = useCallback(async (t: TableInfo, bill: TableBill) => {
    toast.info('Preparing bill…');
    try {
      const order = await ordersApi.get(bill.id);
      await printBill({ ...order, table_label: order.table_label ?? t.table_number }, settings);
    } catch (e) {
      toast.error(e instanceof ApiError ? errorMessage(e) : printErrorMessage(e));
    }
  }, [settings]);

  const removeTable = useCallback(async (t: TableInfo) => {
    const ok = await confirm({
      title: `Remove table ${t.table_number}?`,
      message: 'It disappears from the floor view and its QR code stops working. Past bills are kept.',
      confirmLabel: 'Remove table', danger: true,
    });
    if (!ok) return;
    try {
      await tablesApi.remove(t.id);
      toast.success(`Table ${t.table_number} removed`);
      void silentReload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }, [silentReload]);

  const printOneQr = useCallback(async (t: TableInfo) => {
    try {
      await printTableQrs([t], tenantId, businessName);
    } catch (e) {
      toast.error(printErrorMessage(e));
    }
  }, [tenantId, businessName]);

  const menuFor = useCallback((t: TableInfo): ActionMenuItem[] => {
    const s = byId.get(t.id);
    const bills = s?.bills ?? [];
    const busy = bills.length > 0;
    const items: ActionMenuItem[] = [];
    if (canOrder) {
      bills.forEach((b, i) => {
        const progress = kitchenProgress(b.kitchen);
        items.push({
          key: `open-${b.id}`, group: 'bills', icon: b.status === 'placed' ? 'notifications-outline' : 'receipt-outline',
          label: b.status === 'placed' ? `Review new QR order${bills.length > 1 ? ` (${billName(b, i)})` : ''}` : bills.length > 1 ? `Open ${billName(b, i)}` : 'Open bill',
          description: [money(b.total_amount, sym), progress?.label, b.guests ? `${b.guests} guests` : null].filter(Boolean).join(' · '),
          onPress: () => openBill(b),
        });
      });
      items.push(busy
        ? { key: 'separate', group: 'bills', icon: 'add-circle-outline', label: 'Start a separate bill', description: 'Another party pays on its own',
          onPress: () => router.push({ pathname: '/pos', params: { table: t.id, bill: 'new' } }) }
        : { key: 'start', group: 'bills', icon: 'add-circle-outline', label: 'Start order', onPress: () => open(t) });
      if (busy) {
        const movable = bills.some((b) => b.status !== 'placed');
        const otherBills = tables.some((x) => x.id !== t.id && billsOf(x).length > 0) || bills.length > 1;
        items.push({ key: 'move', group: 'floor', icon: 'swap-horizontal', label: bills.length > 1 ? 'Move a bill…' : 'Move to another table…', shortcut: 'M',
          disabled: tables.length < 2 || !movable, disabledReason: tables.length < 2 ? 'No other tables' : 'Accept the QR order first',
          onPress: () => setMoveFrom({ table: t, mode: 'move' }) });
        items.push({ key: 'merge', group: 'floor', icon: 'git-merge-outline', label: 'Merge into another bill…',
          disabled: !otherBills || !movable, disabledReason: !movable ? 'Accept the QR order first' : 'No other running bill to merge into',
          onPress: () => setMoveFrom({ table: t, mode: 'merge' }) });
        bills.filter((b) => b.status !== 'placed').forEach((b, i) => {
          items.push({ key: `print-${b.id}`, group: 'floor', icon: 'print-outline', label: bills.length > 1 ? `Print ${billName(b, i)}` : 'Print bill', onPress: () => void printTableBill(t, b) });
        });
      }
    }
    if (manager) {
      items.push({ key: 'waiter', group: 'manage', icon: 'person-outline', label: 'Assign waiter…',
        description: t.assigned_staff_name ?? undefined, onPress: () => setWaiterFor(t) });
      items.push({ key: 'qr', group: 'manage', icon: 'qr-code-outline', label: 'Print QR code', onPress: () => void printOneQr(t) });
      items.push({ key: 'edit', group: 'manage', icon: 'create-outline', label: 'Edit table', onPress: () => { setEditing(t); setFormOpen(true); } });
      items.push({ key: 'remove', group: 'danger', icon: 'trash-outline', label: 'Remove table…', danger: true,
        disabled: busy, disabledReason: 'Close the running bill first', onPress: () => void removeTable(t) });
    }
    return items;
  }, [byId, canOrder, manager, tables, sym, openBill, open, printTableBill, printOneQr, removeTable]);

  if (settings?.business_type === 'retail') {
    return (
      <Screen title="Tables">
        <EmptyState icon="grid-outline" title="Tables are for restaurants"
          message="Your business is set up as a retail store, so there is no floor plan. Change the business type in Settings → Business if you serve customers at tables."
          action={{ label: 'Go to Billing', onPress: () => router.push('/pos'), icon: 'receipt-outline' }} />
      </Screen>
    );
  }

  const compact = size === 'compact';
  const minTile = compact ? (isPhone ? 104 : 128) : (isPhone ? 150 : 184);

  const filters = [
    { key: 'all', label: 'All', count: counts.all },
    { key: 'free', label: 'Free', count: counts.free, icon: 'ellipse-outline' as const },
    { key: 'occupied', label: 'Occupied', count: counts.occupied, icon: 'restaurant-outline' as const },
    { key: 'ready', label: 'Ready to serve', count: counts.ready, icon: 'notifications-outline' as const },
    { key: 'payment', label: 'Waiting payment', count: counts.payment, icon: 'wallet-outline' as const },
  ];

  const toolbar = tables.length ? (
    <View style={{ gap: 10 }}>
      <FilterBar onSearch={setQuery} searchPlaceholder="Table, customer or bill no." filters={filters} value={filter}
        onChange={(k) => setFilter(k as TableFilter)} />
      {realSections.length > 1 ? (
        <ChipRow>
          <Chip label="All sections" count={`${occupied.length}/${tables.length}`} selected={!section} onPress={() => setSection(null)} icon="layers-outline" />
          {realSections.map((s) => (
            <Chip key={s.name} label={s.name} count={`${s.busy}/${s.total}`} selected={section === s.name} onPress={() => setSection(section === s.name ? null : s.name)} />
          ))}
        </ChipRow>
      ) : null}
    </View>
  ) : undefined;

  return (
    <Screen
      title="Tables"
      subtitle={tables.length
        ? `${occupied.length} of ${tables.length} occupied${occupied.length ? ` · ${money(runningTotal, sym, true)} running` : ''}${readyLines ? ` · ${readyLines} ready to serve` : ''}`
        : undefined}
      onRefresh={reload}
      maxWidth={isDesktop ? 2400 : 1280}
      actions={
        <>
          {tables.length && !isPhone ? (
            <IconButton icon={compact ? 'apps-outline' : 'grid-outline'} variant="secondary"
              accessibilityLabel={compact ? 'Show large tiles' : 'Show compact tiles'} onPress={() => setSize(compact ? 'large' : 'compact')} />
          ) : null}
          {manager && tables.length ? <Button title={isPhone ? undefined : 'QR codes'} accessibilityLabel="Table QR codes" icon="qr-code-outline" variant="outline" onPress={() => setQrOpen(true)} /> : null}
          {manager ? <Button title={isPhone ? 'Add' : 'Add table'} icon="add" onPress={() => { setEditing(null); setFormOpen(true); }} /> : null}
        </>
      }
      toolbar={toolbar}
    >
      {manager && settings && !settings.qr_ordering_enabled && tables.length ? (
        <Notice tone="neutral" icon="qr-code-outline" title="QR ordering is off"
          message="Guests can scan a table QR to see your menu and order from their phone. Turn it on in Settings → Business."
          action={{ label: 'Open Settings', onPress: () => router.push('/settings') }} />
      ) : null}

      {loading && !data ? (
        <Grid minItemWidth={minTile} gap={10} maxColumns={16}>
          {Array.from({ length: isPhone ? 9 : 18 }, (_, i) => <Skeleton key={i} height={compact ? 116 : 144} radius={12} />)}
        </Grid>
      ) : null}
      {error && !data ? <ErrorState message={error} onRetry={reload} /> : null}

      {data && !tables.length ? (
        <EmptyState icon="grid-outline" title="No tables yet"
          message={manager ? 'Add your tables to see the floor at a glance, start dine-in bills with one tap and print QR codes for ordering.' : 'Ask a manager to add tables in this screen.'}
          action={manager ? { label: 'Add tables', onPress: () => { setEditing(null); setFormOpen(true); }, icon: 'add' } : undefined} />
      ) : null}

      {data && tables.length ? (
        <View style={styles.statusRow}>
          <LiveStatus updatedAt={poll.updatedAt} error={error} paused={!poll.live} intervalLabel="8 s" />
          <Legend />
        </View>
      ) : null}

      {data && tables.length && !visible.length ? (
        <EmptyState icon="funnel-outline" title={q ? 'No table matches' : filter === 'free' ? 'Every table is busy' : 'No tables here'}
          action={{ label: 'Show all tables', onPress: () => { setFilter('all'); setSection(null); } }} />
      ) : null}

      {groups.map(([name, list]) => (
        <View key={name} style={{ gap: 8 }}>
          {realSections.length > 1 && !section ? (
            <GroupTitle title={`${name} · ${list.filter((x) => x.s.bills.length > 0).length}/${list.length} occupied`} />
          ) : null}
          <Grid minItemWidth={minTile} gap={isPhone ? 8 : 10} maxColumns={16}>
            {list.map(({ t, s }) => (
              <TableTile key={t.id} table={t} s={s} sym={sym} compact={compact} waiter={nameOf(s)} ageLimits={ages.table}
                menu={menuFor(t)} onOpen={() => open(t)} />
            ))}
          </Grid>
        </View>
      ))}

      {data && tables.length ? (
        <Text variant="small" tone="subtle" align="center" style={{ marginTop: 4 }}>
          Tap a table to open it in Billing · {isPhone || Platform.OS !== 'web' ? 'long-press' : 'right-click'} or ⋯ for move, merge, print and more
        </Text>
      ) : null}

      <MoveMergeSheet from={moveFrom?.table ?? null} mode={moveFrom?.mode ?? 'move'} tables={tables} onClose={() => setMoveFrom(null)} onDone={refreshAll} />

      <ListSheet visible={!!waiterFor} onClose={() => setWaiterFor(null)} title={waiterFor ? `Waiter for table ${waiterFor.table_number}` : ''}
        subtitle="New bills on this table are credited to this waiter"
        actions={waiterActions(waiterFor, staffList, async (staffId) => {
          if (!waiterFor) return;
          try {
            await opsApi.assignWaiter(waiterFor.id, staffId);
            const picked = staffList?.find((x) => x.id === staffId);
            toast.success(staffId ? `Table ${waiterFor.table_number} → ${picked?.full_name || picked?.email || 'waiter'}` : `Waiter removed from table ${waiterFor.table_number}`);
            void silentReload();
          } catch (e) {
            toast.error(errorMessage(e));
          }
        })}>
        {staff === 'denied' ? <Notice tone="neutral" message="Your role can't see the staff list. Ask the owner to give you staff access." /> : null}
        {staff === null && waiterFor ? <Text variant="small" tone="muted">Loading staff…</Text> : null}
      </ListSheet>

      <TableForm visible={formOpen} onClose={() => setFormOpen(false)} editing={editing} sections={sections.map((x) => x.name).filter((n) => n !== NO_SECTION)}
        existing={tables} onSaved={() => void silentReload()} />

      <QrSheet visible={qrOpen} onClose={() => setQrOpen(false)} tables={tables} tenantId={tenantId} businessName={businessName}
        qrEnabled={!!settings?.qr_ordering_enabled} />
    </Screen>
  );
}

type StaffOption = { id: string; full_name: string | null; email: string; role: string; is_active: boolean };

function waiterActions(table: TableInfo | null, staff: StaffOption[] | null,
  assign: (id: string | null) => Promise<void>): MenuAction[] {
  if (!table || !staff) return [];
  const order = (r: string) => (r === 'waiter' ? 0 : r === 'manager' || r === 'owner' ? 2 : 1);
  const list = staff.filter((s) => s.role !== 'kitchen').sort((a, b) => order(a.role) - order(b.role) || (a.full_name ?? '').localeCompare(b.full_name ?? ''));
  return [
    ...list.map((s) => ({
      label: `${s.full_name || s.email}${s.id === table.assigned_staff_id ? '  ✓' : ''}`, icon: 'person-outline' as const,
      subtitle: s.role.charAt(0).toUpperCase() + s.role.slice(1), onPress: () => void assign(s.id),
    })),
    ...(table.assigned_staff_id ? [{ label: 'No waiter', icon: 'person-remove-outline' as const, onPress: () => void assign(null) }] : []),
  ];
}

function Legend() {
  const { colors } = useTheme();
  const { isPhone } = useLayout();
  if (isPhone) return null;
  const items: [TableState, string][] = [['free', 'Free'], ['occupied', 'Running'], ['ready', 'Food ready'], ['payment', 'Payment'], ['new', 'New QR']];
  return (
    <View style={styles.legend}>
      {items.map(([st, label]) => {
        const c = statusToneColors(colors, STATE_TONE[st]);
        return (
          <View key={st} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: st === 'free' ? colors.surface : c.solid, borderColor: st === 'free' ? colors.borderStrong : c.solid }]} />
            <Text variant="caption" tone="subtle">{label}</Text>
          </View>
        );
      })}
    </View>
  );
}

const TableTile = React.memo(function TableTile({ table, s, sym, compact, waiter, ageLimits, menu, onOpen }: {
  table: TableInfo; s: TableSummary; sym: string; compact: boolean; waiter: string | null; ageLimits: AgeThresholds; menu: ActionMenuItem[]; onOpen: () => void;
}) {
  const menuRef = useRef<ActionMenuHandle>(null);
  const openMenu = useCallback(() => menuRef.current?.open(), []);
  const { colors, radius } = useTheme();
  const { isPhone } = useLayout();
  const busy = s.bills.length > 0;
  const tone = statusToneColors(colors, STATE_TONE[s.state]);
  const age = ageTone(s.minutes, ageLimits);
  const bg = busy ? tone.bg : colors.surface;
  const fg = busy ? tone.fg : colors.text;
  const height = compact ? (isPhone ? 112 : 116) : 144;
  const ini = initials(waiter);
  const a11y = busy
    ? `Table ${table.table_number}, ${STATE_LABEL[s.state]}, ${money(s.total, sym)}, ${formatAge(s.minutes)}${s.guests ? `, ${s.guests} guests` : ''}`
      + `${s.ready ? `, ${s.ready} ready to serve` : ''}${s.upiToConfirm ? ', UPI payment to confirm' : ''}${s.bills.length > 1 ? `, ${s.bills.length} bills` : ''}${waiter ? `, waiter ${waiter}` : ''}`
    : `Table ${table.table_number}, free, ${table.capacity} seats`;

  return (
        <TileBody onPress={onOpen} onMenu={menu.length ? openMenu : undefined} a11y={a11y}
          style={[styles.tile, { height, backgroundColor: bg, borderColor: busy ? tone.solid : colors.border, borderRadius: radius.lg }]}
          hoverStyle={{ borderColor: busy ? tone.fg : colors.borderStrong }}>
          {busy ? <View style={[styles.stripe, { backgroundColor: tone.solid, borderTopLeftRadius: radius.lg, borderBottomLeftRadius: radius.lg }]} /> : null}
          <View style={styles.tileTop}>
            <Text variant={compact ? 'h2' : 'h1'} color={fg} numberOfLines={1} style={styles.tableNo}>{table.table_number}</Text>
            {ini ? <WaiterAvatar initials={ini} name={waiter} size={compact ? 22 : 26} /> : null}
          </View>
          {busy ? (
            <>
              <Text variant={compact ? 'bodyStrong' : 'h3'} color={fg} numberOfLines={1} style={styles.num}>
                {money(s.total, sym, true)}{s.bills.length > 1 ? <Text variant="caption" color={fg}>  · {s.bills.length} bills</Text> : null}
              </Text>
              <View style={styles.metaRow}>
                <AgeChip minutes={s.minutes} tone={age} />
                {s.guests ? (
                  <View style={styles.guests}>
                    <Ionicons name="people-outline" size={13} color={fg} />
                    <Text variant="caption" color={fg} style={styles.num}>{s.guests}</Text>
                  </View>
                ) : null}
              </View>
              <View style={styles.badges}>
                {s.newQr ? <MiniBadge icon="notifications" label="QR" tone="pending" /> : null}
                {s.ready ? <MiniBadge icon="restaurant" label={`${s.ready}`} tone="ready" a11y={`${s.ready} ready to serve`} /> : null}
                {s.upiToConfirm ? <MiniBadge icon="phone-portrait-outline" label="UPI" tone="waiting" a11y="UPI payment to confirm" /> : null}
                {!compact && s.cooking ? <MiniBadge icon="flame-outline" label={`${s.cooking}`} tone="progress" a11y={`${s.cooking} cooking`} /> : null}
              </View>
            </>
          ) : (
            <View style={[styles.metaRow, { marginTop: 'auto' }]}>
              <Ionicons name="people-outline" size={14} color={colors.textSubtle} />
              <Text variant="small" tone="subtle" numberOfLines={1}>{table.capacity} · Free</Text>
            </View>
          )}
          {menu.length ? (
            <ActionMenu menuRef={menuRef} items={menu} align="end" style={styles.more}
              title={`Table ${table.table_number}${busy ? ` · ${money(s.total, sym, true)} · ${formatAge(s.minutes)}` : ' · Free'}`}
              trigger={(openIt) => (isPhone ? null : (
                <Pressable onPress={openIt} hitSlop={6} accessibilityRole="button" accessibilityLabel={`More options for table ${table.table_number}`}
                  style={({ hovered }: any) => [styles.moreBtn, { borderRadius: radius.sm }, hovered && { backgroundColor: colors.surfaceSunken },
                    Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}>
                  <Ionicons name="ellipsis-horizontal" size={16} color={busy ? fg : colors.textSubtle} />
                </Pressable>
              ))} />
          ) : null}
        </TileBody>
  );
});

/** The tile itself: tap opens, long-press (and right-click on web) opens the menu. */
function TileBody({ onPress, onMenu, a11y, style, hoverStyle, children }: {
  onPress: () => void; onMenu?: () => void; a11y: string; style: any; hoverStyle: any; children: React.ReactNode;
}) {
  const ref = useRef<View>(null);
  useContextMenu(ref, onMenu);
  return (
    <Pressable ref={ref} onPress={onPress} onLongPress={onMenu} delayLongPress={350}
      accessibilityRole={Platform.OS === 'web' ? undefined : 'button'} accessibilityLabel={a11y}
      accessibilityHint={onMenu ? 'Long-press for more options' : undefined}
      style={({ pressed, hovered }: any) => [style, (pressed || hovered) && hoverStyle, pressed && { opacity: 0.9 },
        Platform.OS === 'web' && ({ cursor: 'pointer', userSelect: 'none', transitionDuration: '120ms' } as any)]}>
      {children}
    </Pressable>
  );
}

function MiniBadge({ icon, label, tone, a11y }: { icon: keyof typeof Ionicons.glyphMap; label: string; tone: StatusTone; a11y?: string }) {
  const { colors, radius } = useTheme();
  const c = statusToneColors(colors, tone);
  return (
    <View accessibilityLabel={a11y ?? label} style={[styles.mini, { backgroundColor: c.solid, borderRadius: radius.pill }]}>
      <Ionicons name={icon} size={11} color={tone === 'pending' ? colors.onKitchen : colors.surface} />
      <Text variant="caption" color={tone === 'pending' ? colors.onKitchen : colors.surface} style={styles.miniText}>{label}</Text>
    </View>
  );
}

function MoveMergeSheet({ from, mode, tables, onClose, onDone }: {
  from: TableInfo | null; mode: 'move' | 'merge'; tables: TableInfo[]; onClose: () => void; onDone: () => void;
}) {
  const sym = useData((st) => st.settings?.currency_symbol ?? '₹');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [billId, setBillId] = useState<string | null>(null);
  const bills = from ? billsOf(from).filter((b) => b.status !== 'placed') : [];
  const bill = bills.find((b) => b.id === billId) ?? bills[0] ?? null;
  const others = tables.filter((t) => t.id !== from?.id);
  const free = others.filter((t) => billsOf(t).length === 0);
  const busyTables = others.filter((t) => billsOf(t).length > 0);
  // Merge targets: other running bills on this table and on every other table
  const targets: { table: TableInfo; bill: TableBill; index: number }[] = [];
  if (from) {
    billsOf(from).forEach((b, i) => { if (b.id !== bill?.id && b.status !== 'placed') targets.push({ table: from, bill: b, index: i }); });
    busyTables.forEach((t) => billsOf(t).forEach((b, i) => { if (b.status !== 'placed') targets.push({ table: t, bill: b, index: i }); }));
  }
  const label = (b: TableBill) => (bills.length > 1 ? billName(b, bills.indexOf(b)) : `Table ${from?.table_number}`);
  const close = () => { setBillId(null); onClose(); };

  const move = async (to: TableInfo) => {
    if (!from || !bill) return;
    setBusyId(to.id);
    try {
      await ordersApi.transfer(bill.id, to.id);
      toast.success(`${label(bill)} → table ${to.table_number}${billsOf(to).length ? ' (as a separate bill)' : ''}`);
      onDone();
      close();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusyId(null);
    }
  };

  const merge = async (target: { table: TableInfo; bill: TableBill; index: number }) => {
    if (!from || !bill) return;
    const ok = await confirm({
      title: `Merge ${label(bill)} into table ${target.table.table_number}?`,
      message: `Its items and kitchen tickets move to ${billName(target.bill, target.index)} on table ${target.table.table_number} (${money(target.bill.total_amount, sym)}). ${label(bill)} closes as "merged".`,
      confirmLabel: 'Merge bills',
    });
    if (!ok) return;
    setBusyId(target.bill.id);
    try {
      await floorApi.merge(target.bill.id, bill.id);
      toast.success(`Merged into table ${target.table.table_number}`);
      onDone();
      close();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Sheet visible={!!from} onClose={close} width={560}
      title={from ? (mode === 'move' ? `Move table ${from.table_number}` : `Merge from table ${from.table_number}`) : ''}
      subtitle={mode === 'move' ? 'The bill and its kitchen tickets move with it. On a busy table it joins as a separate bill.'
        : 'Bring this bill\'s items into another running bill, so the party pays once.'}>
      {bills.length > 1 ? (
        <View style={{ gap: 6 }}>
          <Text variant="caption" tone="subtle" style={styles.caps}>Which bill?</Text>
          <ChipRow>
            {bills.map((b, i) => (
              <Chip key={b.id} label={`${billName(b, i)} · ${money(b.total_amount, sym, true)}`} selected={b.id === bill?.id} onPress={() => setBillId(b.id)} />
            ))}
          </ChipRow>
        </View>
      ) : null}
      {mode === 'move' ? (
        <>
          {free.length ? (
            <View style={{ gap: 6 }}>
              <Text variant="caption" tone="subtle" style={styles.caps}>Free tables</Text>
              <Grid minItemWidth={88} gap={8} maxColumns={8}>
                {free.map((t) => (
                  <Button key={t.id} title={t.table_number} variant="outline" onPress={() => void move(t)} loading={busyId === t.id}
                    disabled={!!busyId || !bill} accessibilityLabel={`Move to table ${t.table_number}`} full />
                ))}
              </Grid>
            </View>
          ) : <Text variant="small" tone="muted">No free tables right now.</Text>}
          {busyTables.length ? (
            <View style={{ gap: 6 }}>
              <Text variant="caption" tone="subtle" style={styles.caps}>Join a busy table (separate bill)</Text>
              <Grid minItemWidth={88} gap={8} maxColumns={8}>
                {busyTables.map((t) => (
                  <Button key={t.id} title={t.table_number} variant="tonal" icon="people-outline" onPress={() => void move(t)} loading={busyId === t.id}
                    disabled={!!busyId || !bill} accessibilityLabel={`Move to busy table ${t.table_number} as a separate bill`} full />
                ))}
              </Grid>
            </View>
          ) : null}
        </>
      ) : targets.length ? (
        <View style={{ gap: 6 }}>
          <Text variant="caption" tone="subtle" style={styles.caps}>Merge into</Text>
          {targets.map((x) => (
            <Button key={x.bill.id} variant="outline" icon="git-merge-outline" full loading={busyId === x.bill.id} disabled={!!busyId || !bill}
              title={`Table ${x.table.table_number} · ${billName(x.bill, x.index)} · ${money(x.bill.total_amount, sym, true)}`}
              onPress={() => void merge(x)} style={{ justifyContent: 'flex-start' }} />
          ))}
        </View>
      ) : <Text variant="small" tone="muted">No other running bill to merge into.</Text>}
      {!others.length && mode === 'move' ? <EmptyState icon="grid-outline" title="No other tables" message="Add more tables to move bills between them." /> : null}
    </Sheet>
  );
}

function QrSheet({ visible, onClose, tables, tenantId, businessName, qrEnabled }: {
  visible: boolean; onClose: () => void; tables: TableInfo[]; tenantId: string; businessName: string; qrEnabled: boolean;
}) {
  const { colors, radius } = useTheme();
  const [printing, setPrinting] = useState(false);
  const printAll = async () => {
    setPrinting(true);
    try {
      await printTableQrs(tables, tenantId, businessName);
    } catch (e) {
      toast.error(printErrorMessage(e));
    } finally {
      setPrinting(false);
    }
  };
  const one = async (t: TableInfo) => {
    try {
      await printTableQrs([t], tenantId, businessName);
    } catch (e) {
      toast.error(printErrorMessage(e));
    }
  };
  return (
    <Sheet visible={visible} onClose={onClose} title="Table QR codes" subtitle="Guests scan to see the menu and order from their phone" width={760}
      footer={
        <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'flex-end' }}>
          <Button title="Close" variant="outline" onPress={onClose} />
          <Button title={`Print all (${tables.length})`} icon="print-outline" onPress={printAll} loading={printing} disabled={!tables.length} />
        </View>
      }>
      {!qrEnabled ? (
        <Notice tone="warning" title="QR ordering is off" message="Codes will open your menu, but guests can't place orders until you turn on QR ordering in Settings → Business."
          action={{ label: 'Open Settings', onPress: () => { onClose(); router.push('/settings'); } }} />
      ) : null}
      {visible ? (
        <ScrollView style={{ maxHeight: 560 }}>
          <Grid minItemWidth={150} gap={12}>
            {tables.map((t) => (
              <Pressable key={t.id} onPress={() => void one(t)} accessibilityRole="button" accessibilityLabel={`Print QR code for table ${t.table_number}`}
                style={({ hovered }: any) => [styles.qrCard, { borderColor: hovered ? colors.borderStrong : colors.border, borderRadius: radius.lg, backgroundColor: colors.surfaceAlt }]}>
                <QrCode value={tableOrderUrl(tenantId, t.id)} size={124} margin={3} style={{ borderRadius: radius.sm, overflow: 'hidden' }} />
                <Text variant="h3" numberOfLines={1}>Table {t.table_number}</Text>
                {t.section ? <Text variant="small" tone="subtle" numberOfLines={1}>{t.section}</Text> : null}
                <View style={styles.metaRow}>
                  <Ionicons name="print-outline" size={13} color={colors.textMuted} />
                  <Text variant="caption" tone="muted">Print</Text>
                </View>
              </Pressable>
            ))}
          </Grid>
        </ScrollView>
      ) : null}
      <Text variant="small" tone="subtle">Tip: print on thick paper or laminate it, and stick one on each table.</Text>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap', justifyContent: 'space-between' },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 10, height: 10, borderRadius: 3, borderWidth: 1 },
  tile: { borderWidth: 1.5, paddingVertical: 8, paddingLeft: 12, paddingRight: 8, gap: 3, overflow: 'hidden' },
  stripe: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },
  tileTop: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingRight: 22, flexShrink: 0 },
  tableNo: { flexShrink: 1, flexGrow: 1, fontVariant: ['tabular-nums'] },
  num: { fontVariant: ['tabular-nums'], flexShrink: 0 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0 },
  guests: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  badges: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 'auto', minHeight: 18, flexShrink: 0 },
  mini: { flexDirection: 'row', alignItems: 'center', gap: 2, height: 18, paddingHorizontal: 6 },
  miniText: { fontSize: 11, lineHeight: 14, letterSpacing: 0, fontVariant: ['tabular-nums'] },
  more: { position: 'absolute', top: 4, right: 4, width: 28, height: 28 },
  moreBtn: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  caps: { textTransform: 'uppercase' },
  qrCard: { borderWidth: 1, padding: 12, alignItems: 'center', gap: 6 },
});
