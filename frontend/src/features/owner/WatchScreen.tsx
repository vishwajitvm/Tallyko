/**
 * Owner's watch: cancelled bills, items cancelled or removed, on the house, discounts and menu changes — who did what.
 * Only the owner sees it (the server answers 403 for everyone else); nothing here can be edited or deleted.
 * Corrections go to Tallyko through "Ask Tallyko".
 *
 * High-volume layout (docs/20_High_Volume_UX.md): every tab, including the staff ranking, is one virtualised DataList —
 * a dense table on desktops with the summary pinned above it, cards on tablets and phones where the summary scrolls with the list.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ownerApi, type OwnerRequest, type WatchEvent, type WatchStaffRow, type WatchTotals } from '@/api/owner';
import { errorMessage } from '@/api/client';
import {
  ActionMenu, Badge, Button, Chip, DataList, EmptyState, IconButton, Input, Screen, Sheet, Skeleton, Text, toast,
  type ActionMenuItem, type BadgeTone, type DataColumn,
} from '@/components/ui';
import { useApi } from '@/hooks/useApi';
import { useAuth } from '@/store/auth';
import { useData } from '@/store/data';
import { useNet } from '@/lib/sync';
import { formatDateTime, money } from '@/lib/format';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import type { ThemeColors } from '@/theme/tokens';
import { OrderDetail } from '@/features/ops/OrderDetail';
import { presetRange, rangeLabel, rangeQuery, validateCustom, ymd, type ReportRange } from '@/features/reports/range';
import { AskTallykoSheet, RequestsCard } from './AskTallyko';
import { filterByStaff, plural, rankStaff, staffLoss, staffOptions, totalLoss } from './watchUtils';
import { viewCount, watchRows, type WatchRow, type WatchView } from './watchRows';

type IconName = keyof typeof Ionicons.glyphMap;
type Period = 'today' | '7d' | '30d';
/** Activity-log events per request (the report's first page and each "load more"). */
const EVENTS_PAGE = 500;

const PERIODS: { id: Period; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
];

const TABS: { id: WatchView; label: string; short: string; icon: IconName }[] = [
  { id: 'staff', label: 'By staff', short: 'Staff', icon: 'people-outline' },
  { id: 'bills', label: 'Cancelled bills', short: 'Bills', icon: 'close-circle-outline' },
  { id: 'items', label: 'Removed & cancelled items', short: 'Items', icon: 'remove-circle-outline' },
  { id: 'comps', label: 'On the house', short: 'Free', icon: 'gift-outline' },
  { id: 'discounts', label: 'Discounts', short: 'Discounts', icon: 'pricetag-outline' },
  { id: 'menu', label: 'Menu changes', short: 'Menu', icon: 'create-outline' },
  { id: 'timeline', label: 'Timeline', short: 'Timeline', icon: 'time-outline' },
  { id: 'requests', label: 'Your requests', short: 'Requests', icon: 'chatbubbles-outline' },
];

const KIND_ICON: Record<string, { icon: IconName; tone: BadgeTone }> = {
  'order.cancel': { icon: 'close-circle', tone: 'danger' },
  'order.void_item': { icon: 'flame', tone: 'danger' },
  'order.remove_item': { icon: 'remove-circle', tone: 'warning' },
  'order.comp': { icon: 'gift', tone: 'accent' },
  'order.discount': { icon: 'pricetag', tone: 'info' },
  'order.split': { icon: 'git-branch', tone: 'neutral' },
  'order.merge': { icon: 'git-merge', tone: 'neutral' },
  'order.reprint': { icon: 'print', tone: 'neutral' },
  'order.archive': { icon: 'archive', tone: 'primary' },
  'menu.change': { icon: 'create', tone: 'primary' },
  'menu.remove': { icon: 'create', tone: 'danger' },
};

function toneColors(colors: ThemeColors, tone: BadgeTone): [string, string] {
  switch (tone) {
    case 'danger': return [colors.dangerSoft, colors.dangerText];
    case 'warning': return [colors.warningSoft, colors.warningText];
    case 'success': return [colors.successSoft, colors.successText];
    case 'info': return [colors.infoSoft, colors.infoText];
    case 'accent': return [colors.accentSoft, colors.accentText];
    case 'primary': return [colors.primarySoft, colors.primarySoftText];
    default: return [colors.surfaceSunken, colors.textMuted];
  }
}

export default function WatchScreen() {
  const role = useAuth((s) => s.session?.role ?? null);
  if (role !== 'owner') {
    return (
      <Screen title="Owner's watch">
        <EmptyState icon="lock-closed-outline" title="Only the owner can see this page" message="Ask the owner of the business if you need something from here." />
      </Screen>
    );
  }
  return <OwnerWatchView />;
}

function OwnerWatchView() {
  const { colors } = useTheme();
  const { isPhone, isDesktop } = useLayout();
  const sym = useData((s) => s.settings?.currency_symbol) ?? '₹';
  const online = useNet((s) => s.online && s.serverReachable);

  const [range, setRange] = useState<ReportRange>(() => presetRange('7d'));
  const [customOpen, setCustomOpen] = useState(false);
  const [fromText, setFromText] = useState('');
  const [toText, setToText] = useState('');
  const [customErrors, setCustomErrors] = useState<{ from?: string; to?: string }>({});
  const [staffId, setStaffId] = useState<string | null>(null);
  const [tab, setTab] = useState<WatchView>('staff');
  const [openBill, setOpenBill] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  const q = rangeQuery(range);
  const watch = useApi(() => ownerApi.watch({ date_from: q.from, date_to: q.to, staff_id: staffId, limit: EVENTS_PAGE }), [q.from, q.to, staffId]);
  const requests = useApi(() => ownerApi.requests(), []);

  // Timeline: more of the activity log, page by page (the first page comes with the report)
  const [moreEvents, setMoreEvents] = useState<WatchEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  useEffect(() => { setMoreEvents([]); }, [watch.data]);
  const fullWatch = useMemo(() => (watch.data && moreEvents.length ? { ...watch.data, events: [...watch.data.events, ...moreEvents] } : watch.data),
    [watch.data, moreEvents]);
  const eventsTotal = fullWatch?.events_total ?? 0;
  const moreToLoad = !!fullWatch && fullWatch.events.length < eventsTotal;
  const loadMoreEvents = useCallback(async () => {
    if (!fullWatch || loadingEvents || !moreToLoad) return;
    setLoadingEvents(true);
    try {
      const page = await ownerApi.watch({ date_from: q.from, date_to: q.to, staff_id: staffId, limit: EVENTS_PAGE, offset: fullWatch.events.length });
      const seen = new Set(fullWatch.events.map((e) => e.id));
      setMoreEvents((prev) => [...prev, ...page.events.filter((e) => !seen.has(e.id))]);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setLoadingEvents(false);
    }
  }, [fullWatch, loadingEvents, moreToLoad, q.from, q.to, staffId]);

  const view = useMemo(() => (fullWatch ? filterByStaff(fullWatch, staffId) : null), [fullWatch, staffId]);
  // The staff list comes from the unfiltered view (the server narrows the activity log once someone is picked).
  const peopleRef = useRef<{ id: string; name: string }[]>([]);
  const people = useMemo(() => {
    if (watch.data && (!staffId || !peopleRef.current.length)) peopleRef.current = staffOptions(watch.data);
    return peopleRef.current;
  }, [watch.data, staffId]);
  const effectiveTab: WatchView = staffId && tab === 'staff' ? 'bills' : tab;

  const pickPreset = (p: Period) => {
    setCustomOpen(false);
    setCustomErrors({});
    setRange(presetRange(p));
  };
  const openCustom = () => {
    setFromText(ymd(range.start));
    setToText(ymd(new Date(range.end.getFullYear(), range.end.getMonth(), range.end.getDate() - 1)));
    setCustomErrors({});
    setCustomOpen(true);
  };
  const applyCustom = () => {
    const r = validateCustom(fromText, toText);
    if (r.errors) { setCustomErrors(r.errors); return; }
    setCustomOpen(false);
    setRange(r.range);
  };
  const refresh = () => { void watch.reload(); void requests.reload(); };
  const staffName = staffId ? people.find((p) => p.id === staffId)?.name ?? 'Staff member' : null;

  const staffMenu: ActionMenuItem[] = [
    { key: 'all', label: 'Everyone', icon: 'people-outline', selected: !staffId, onPress: () => setStaffId(null) },
    ...people.map((p) => ({ key: p.id, label: p.name, icon: 'person-outline' as const, selected: staffId === p.id, onPress: () => setStaffId(p.id) })),
  ];

  const toolbar = (
    <View style={{ gap: 10 }}>
      <View style={styles.filterRow}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 1, flexShrink: 1 }} contentContainerStyle={styles.chips}>
          {PERIODS.map((p) => (
            <Chip key={p.id} label={p.label} selected={range.preset === p.id && !customOpen} onPress={() => pickPreset(p.id)} />
          ))}
          <Chip label={range.preset === 'custom' && !customOpen ? rangeLabel(range) : 'Custom'} icon="calendar-outline"
            selected={range.preset === 'custom' || customOpen} onPress={() => (customOpen ? setCustomOpen(false) : openCustom())} />
        </ScrollView>
        {people.length ? (
          <ActionMenu items={staffMenu} title="Show actions by" align="end"
            trigger={(open) => <Button title={staffName ?? 'Everyone'} icon={staffId ? 'person' : 'people-outline'} iconRight="chevron-down"
              variant={staffId ? 'tonal' : 'outline'} onPress={open} accessibilityLabel="Filter by staff member" />} />
        ) : null}
      </View>
      {customOpen ? (
        <View style={[styles.custom, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Input label="From" value={fromText} onChangeText={(v) => { setFromText(v); setCustomErrors((e) => ({ ...e, from: undefined })); }}
            placeholder="YYYY-MM-DD" error={customErrors.from} containerStyle={styles.dateInput} maxLength={10} autoCorrect={false}
            keyboardType="numbers-and-punctuation" icon="calendar-outline" />
          <Input label="To" value={toText} onChangeText={(v) => { setToText(v); setCustomErrors((e) => ({ ...e, to: undefined })); }}
            placeholder="YYYY-MM-DD" error={customErrors.to} containerStyle={styles.dateInput} maxLength={10} autoCorrect={false}
            keyboardType="numbers-and-punctuation" icon="calendar-outline" returnKeyType="go" onSubmitEditing={applyCustom} />
          <View style={styles.customActions}>
            <Button title="Cancel" variant="ghost" onPress={() => setCustomOpen(false)} />
            <Button title="Apply" icon="checkmark" onPress={applyCustom} />
          </View>
        </View>
      ) : null}
    </View>
  );

  // --- rows / columns ---
  const w = view?.watch ?? null;
  const totals = view?.totals ?? null;
  const rows = useMemo(() => (w ? watchRows(effectiveTab, w, !!staffId) : []), [w, effectiveTab, staffId]);
  const staffRows = useMemo(() => (w ? rankStaff(w.by_staff) : []), [w]);

  const kindIcon = (kind: string, size = 30) => {
    const meta = KIND_ICON[kind] ?? { icon: 'ellipse' as IconName, tone: 'neutral' as BadgeTone };
    const [bg, fg] = toneColors(colors, meta.tone);
    return <View style={[styles.rowIcon, { width: size, height: size, backgroundColor: bg }]}><Ionicons name={meta.icon} size={size / 2} color={fg} /></View>;
  };

  const columns = useMemo<DataColumn<WatchRow>[]>(() => [
    {
      key: 'title', title: 'What', flex: 1.6, minWidth: 180,
      render: (r) => (
        <View style={styles.inline}>
          {kindIcon(r.kind, 26)}
          <Text variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>{r.title}</Text>
          {r.badges.map((b) => <Badge key={b.label} label={b.label} tone={b.tone as BadgeTone} />)}
        </View>
      ),
    },
    { key: 'detail', title: 'Reason / change', flex: 2, minWidth: 160, render: (r) => <Text variant="small" tone="muted" numberOfLines={1}>{r.detail || '—'}</Text> },
    { key: 'by', title: 'By', width: 140, value: (r) => r.by ?? '—' },
    { key: 'at', title: 'When', width: 150, hideBelow: 900, value: (r) => (r.at ? formatDateTime(r.at) : '—') },
    { key: 'amount', title: 'Amount', width: 110, numeric: true, render: (r) => (r.amount !== null ? <Text variant="money">{money(r.amount, sym)}</Text> : <Text tone="subtle">—</Text>) },
  ], [colors, sym]); // eslint-disable-line react-hooks/exhaustive-deps

  const renderCard = (r: WatchRow) => (
    <View style={styles.inline}>
      {kindIcon(r.kind)}
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <View style={styles.inline}>
          <Text variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>{r.title}</Text>
          {r.badges.slice(0, 1).map((b) => <Badge key={b.label} label={b.label} tone={b.tone as BadgeTone} />)}
        </View>
        <Text variant="small" tone="muted" numberOfLines={1}>{r.detail || '—'}</Text>
        <Text variant="caption" tone="subtle" numberOfLines={1}>{[r.by ?? (r.at ? 'Unknown' : null), r.at ? formatDateTime(r.at) : null].filter(Boolean).join(' · ') || ' '}</Text>
      </View>
      {r.amount !== null ? <Text variant="money">{money(r.amount, sym)}</Text> : null}
    </View>
  );

  const cellCount = (count: number, value: number, what: string) => (count ? `${plural(count, what)} · ${money(value, sym, true)}` : '—');
  const staffColumns = useMemo<DataColumn<WatchStaffRow>[]>(() => [
    { key: 'rank', title: '#', width: 52, render: (r) => <Rank n={staffRows.indexOf(r) + 1} /> },
    { key: 'name', title: 'Staff', flex: 1.4, minWidth: 140, render: (r) => <Text variant="bodyStrong" numberOfLines={1}>{r.name}</Text> },
    { key: 'bills', title: 'Cancelled bills', flex: 1, minWidth: 120, hideBelow: 760, value: (r) => cellCount(r.cancelled_bills, r.cancelled_bills_value, 'bill') },
    { key: 'after', title: 'After kitchen', flex: 1, minWidth: 120, hideBelow: 900, value: (r) => cellCount(r.items_cancelled, r.items_cancelled_value, 'item') },
    { key: 'before', title: 'Before kitchen', flex: 1, minWidth: 120, hideBelow: 1040, value: (r) => cellCount(r.items_removed, r.items_removed_value, 'item') },
    { key: 'disc', title: 'Discounts', flex: 1, minWidth: 110, hideBelow: 1180, value: (r) => cellCount(r.discounts, r.discount_value, 'bill') },
    { key: 'total', title: 'Taken off', width: 120, numeric: true, render: (r) => { const l = staffLoss(r); return <Text variant="money" tone={l ? 'danger' : 'muted'}>{money(l, sym)}</Text>; } },
  ], [staffRows, sym]); // eslint-disable-line react-hooks/exhaustive-deps

  const renderStaffCard = (r: WatchStaffRow) => {
    const loss = staffLoss(r);
    return (
      <View style={styles.inline}>
        <Rank n={staffRows.indexOf(r) + 1} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text variant="bodyStrong" numberOfLines={1}>{r.name}</Text>
          <Text variant="small" tone="muted" numberOfLines={2}>
            {[
              r.cancelled_bills ? `${plural(r.cancelled_bills, 'bill')} cancelled` : null,
              r.items_cancelled ? `${plural(r.items_cancelled, 'item')} after kitchen` : null,
              r.items_removed ? `${plural(r.items_removed, 'item')} before kitchen` : null,
              r.discounts ? plural(r.discounts, 'discount') : null,
            ].filter(Boolean).join(' · ') || 'No changes'}
          </Text>
        </View>
        <Text variant="money" tone={loss ? 'danger' : 'muted'}>{money(loss, sym)}</Text>
      </View>
    );
  };

  // --- summary (tiles act as tab shortcuts) ---
  const summary = totals ? (
    <Summary totals={totals} sym={sym} staffName={staffName} label={rangeLabel(range)} loading={watch.loading} tab={effectiveTab} onTab={setTab} />
  ) : watch.loading ? (
    <View style={{ gap: 10 }}>
      <Skeleton height={64} />
      <Skeleton height={64} />
    </View>
  ) : null;

  const tabs = w && totals ? (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={[styles.chips, { paddingVertical: 4 }]}>
      {TABS.filter((t) => !(staffId && t.id === 'staff')).map((t) => (
        <Chip key={t.id} label={isPhone ? t.short : t.label} icon={t.icon} selected={effectiveTab === t.id} onPress={() => setTab(t.id)}
          count={viewCount(t.id, w, totals, requests.data?.length ?? 0)} />
      ))}
    </ScrollView>
  ) : null;

  const errorBanner = watch.error && view ? (
    <View style={[styles.banner, { backgroundColor: colors.warningSoft }]}>
      <Ionicons name="cloud-offline-outline" size={16} color={colors.warningText} />
      <Text variant="small" tone="warning" style={{ flex: 1 }} numberOfLines={2}>{online ? `Could not refresh: ${watch.error}` : "You're offline"} — showing what was loaded earlier.</Text>
      <Button title="Retry" size="sm" variant="ghost" onPress={refresh} />
    </View>
  ) : null;

  const tableMode = isDesktop;
  const header = (
    <View style={{ gap: 12, paddingBottom: tableMode ? 0 : 10 }}>
      {errorBanner}
      {summary}
      {tabs}
    </View>
  );

  const emptyFor = (t: WatchView): { icon: IconName; title: string; message?: string } => {
    switch (t) {
      case 'staff': return { icon: 'checkmark-circle-outline', title: 'Nobody took anything off bills', message: 'Cancellations, removed items and discounts by each person show up here.' };
      case 'bills': return { icon: 'checkmark-circle-outline', title: 'No cancelled bills' };
      case 'items': return { icon: 'checkmark-circle-outline', title: 'No items cancelled or removed' };
      case 'comps': return { icon: 'gift-outline', title: 'Nothing given on the house' };
      case 'discounts': return {
        icon: 'pricetag-outline', title: 'No discounts given',
        message: totals ? `${plural(totals.discounted_bills, 'paid bill')} had a manual discount (offers and coupons not included).` : undefined,
      };
      case 'menu': return { icon: 'create-outline', title: 'No menu changes', message: 'Price edits and items taken off the menu show up here.' };
      default: return { icon: 'time-outline', title: 'Nothing happened', message: 'Cancellations, removals, discounts, splits, reprints and menu changes appear here.' };
    }
  };

  const loadError = !view && !watch.loading ? (online ? watch.error ?? 'Could not load the owner’s watch.' : "You're offline. Owner's watch needs an internet connection; billing keeps working offline.") : null;

  let list: React.ReactNode;
  if (effectiveTab === 'requests') {
    list = (
      <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 24 }}>
        {tableMode ? null : header}
        <RequestsCard requests={requests.data} loading={requests.loading} error={requests.error} onRetry={() => void requests.reload()} onAsk={() => setAsking(true)} />
      </ScrollView>
    );
  } else if (effectiveTab === 'staff') {
    list = (
      <DataList<WatchStaffRow>
        data={w ? staffRows : null}
        keyExtractor={(r, i) => r.staff_id ?? `none-${i}`}
        columns={staffColumns}
        renderCard={renderStaffCard}
        layout={tableMode ? 'table' : 'cards'}
        cardHeight={76}
        loading={watch.loading && !w}
        error={loadError}
        onRetry={refresh}
        refreshing={watch.refreshing}
        onRefresh={refresh}
        onPressRow={(r) => { if (r.staff_id) { setStaffId(r.staff_id); setTab('timeline'); } }}
        keyboard={!openBill && !asking}
        ListHeaderComponent={tableMode ? null : header}
        empty={emptyFor('staff')}
        testID="watch-staff"
      />
    );
  } else {
    list = (
      <DataList<WatchRow>
        data={w ? rows : null}
        keyExtractor={(r) => r.key}
        columns={columns}
        renderCard={renderCard}
        layout={tableMode ? 'table' : 'cards'}
        cardHeight={84}
        loading={watch.loading && !w}
        error={loadError}
        onRetry={refresh}
        refreshing={watch.refreshing}
        onRefresh={refresh}
        onPressRow={(r) => { if (r.orderId) setOpenBill(r.orderId); }}
        onEndReached={effectiveTab === 'timeline' ? () => void loadMoreEvents() : undefined}
        loadingMore={effectiveTab === 'timeline' && loadingEvents}
        hasMore={effectiveTab === 'timeline' ? moreToLoad : false}
        keyboard={!openBill && !asking}
        ListHeaderComponent={tableMode ? null : header}
        empty={emptyFor(effectiveTab)}
        testID="watch-rows"
      />
    );
  }

  return (
    <Screen
      title="Owner's watch"
      subtitle={`${rangeLabel(range)}${staffName ? ` · ${staffName}` : ''} · only you can see this; nothing here can be edited`}
      scroll={false}
      contentStyle={{ flex: 1, paddingBottom: 16, gap: 12 }}
      maxWidth={isDesktop ? 1680 : 1280}
      toolbar={toolbar}
      actions={(
        <>
          {!isPhone ? <IconButton icon="refresh" accessibilityLabel="Refresh" onPress={refresh} disabled={watch.loading} /> : null}
          <Button title={isPhone ? 'Ask' : 'Ask Tallyko'} icon="chatbubbles-outline" variant="outline" onPress={() => setAsking(true)} />
        </>
      )}
    >
      {tableMode ? header : null}
      <View style={[styles.list, tableMode && { borderWidth: 1, borderRadius: 14, borderColor: colors.border, backgroundColor: colors.surface }]}>
        {list}
      </View>

      <Sheet visible={!!openBill} onClose={() => setOpenBill(null)} width={620} title="Bill details"
        subtitle="Removed items are listed on the owner’s watch, not on the bill.">
        {openBill ? <OrderDetail key={openBill} orderId={openBill} onClose={() => setOpenBill(null)} /> : null}
      </Sheet>
      <AskTallykoSheet visible={asking} onClose={() => setAsking(false)} cancelled={watch.data?.cancelled_bills ?? []} symbol={sym}
        onSent={(r: OwnerRequest) => requests.setData([r, ...(requests.data ?? [])])} />
    </Screen>
  );
}

// ---------- Summary ----------

function Summary({ totals, sym, staffName, label, loading, tab, onTab }: {
  totals: WatchTotals; sym: string; staffName: string | null; label: string; loading: boolean; tab: WatchView; onTab: (t: WatchView) => void;
}) {
  const { colors } = useTheme();
  const [width, setWidth] = useState(0);
  const lost = totalLoss(totals);
  const tiles: { tab: WatchView; label: string; value: string; hint: string; icon: IconName; tone: BadgeTone; zero: boolean }[] = [
    { tab: 'bills', label: 'Cancelled bills', value: money(totals.cancelled_bills_value, sym, true), hint: plural(totals.cancelled_bills, 'bill'),
      icon: 'close-circle-outline', tone: 'danger', zero: !totals.cancelled_bills },
    { tab: 'items', label: 'After kitchen', value: money(totals.items_cancelled_value, sym, true), hint: `${plural(totals.items_cancelled, 'item')} cancelled`,
      icon: 'flame-outline', tone: 'danger', zero: !totals.items_cancelled },
    { tab: 'items', label: 'Before kitchen', value: money(totals.items_removed_value, sym, true), hint: `${plural(totals.items_removed, 'item')} removed`,
      icon: 'remove-circle-outline', tone: 'warning', zero: !totals.items_removed },
    { tab: 'comps', label: 'On the house', value: money(totals.on_the_house_value, sym, true), hint: plural(totals.on_the_house, 'item'),
      icon: 'gift-outline', tone: 'accent', zero: !totals.on_the_house },
    { tab: 'discounts', label: 'Discounts', value: money(totals.discount_value, sym, true), hint: plural(totals.discounted_bills, 'bill'),
      icon: 'pricetag-outline', tone: 'info', zero: !totals.discounted_bills },
    { tab: 'menu', label: 'Menu changes', value: String(totals.menu_changes), hint: 'price & item edits',
      icon: 'create-outline', tone: 'primary', zero: !totals.menu_changes },
  ];
  // Headline + 6 tiles: one row on wide desktops, 4 / 3 / 2 per row as space shrinks (never a lone tile)
  const gap = 10;
  const cols = width >= 960 ? 7 : width >= 700 ? 4 : width >= 520 ? 3 : 2;
  const tileW = width ? Math.floor((width - gap * (cols - 1)) / cols) : undefined;
  // The headline is one more tile on wide rows; a full-width row above the tiles on narrow ones
  const headlineW = width && cols < 4 ? width : tileW;
  return (
    <View style={styles.kpis} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <View style={[styles.kpi, { width: headlineW ?? '100%', borderColor: colors.border, backgroundColor: colors.surface, borderLeftWidth: 4, borderLeftColor: lost ? colors.danger : colors.success }]}>
        <Text variant="caption" tone="muted" numberOfLines={1}>{staffName ? `Taken off by ${staffName}` : 'Taken off bills'}{loading ? ' · updating…' : ''}</Text>
        <Text variant="h1" tone={lost ? 'danger' : 'success'} numberOfLines={1} style={styles.num}>{money(lost, sym, true)}</Text>
        <Text variant="caption" tone="subtle" numberOfLines={1}>{label}</Text>
      </View>
      {tiles.map((t) => {
        const [bg, fg] = toneColors(colors, t.zero ? 'neutral' : t.tone);
        const active = tab === t.tab;
        return (
          <Pressable key={t.label} onPress={() => onTab(t.tab)} accessibilityRole="button" accessibilityState={{ selected: active }}
            accessibilityLabel={`${t.label}: ${t.value}, ${t.hint}. Show list`}
            style={({ hovered }: any) => [styles.kpi, {
              width: tileW ?? '47%', borderColor: active ? colors.primary : colors.border,
              backgroundColor: hovered ? colors.surfaceAlt : colors.surface,
            }, Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}>
            <View style={styles.inline}>
              <View style={[styles.kpiIcon, { backgroundColor: bg }]}><Ionicons name={t.icon} size={13} color={fg} /></View>
              <Text variant="caption" tone="muted" numberOfLines={1} style={{ flex: 1 }}>{t.label}</Text>
            </View>
            <Text variant="h2" color={t.zero ? colors.textSubtle : fg} numberOfLines={1} style={styles.num}>{t.value}</Text>
            <Text variant="caption" tone="subtle" numberOfLines={1}>{t.hint}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Rank({ n }: { n: number }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.rank, { backgroundColor: n === 1 ? colors.dangerSoft : colors.surfaceSunken }]}>
      <Text variant="caption" color={n === 1 ? colors.dangerText : colors.textMuted}>{n}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  filterRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  chips: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  custom: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, alignItems: 'flex-start', padding: 14, borderRadius: 14, borderWidth: 1 },
  dateInput: { flexGrow: 1, flexBasis: 160, maxWidth: 240 },
  customActions: { flexDirection: 'row', gap: 8, alignSelf: 'flex-end', paddingBottom: 1 },
  kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  kpi: { gap: 2, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, minHeight: 76 },
  kpiIcon: { width: 22, height: 22, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 0 },
  num: { fontVariant: ['tabular-nums'] },
  rank: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  rowIcon: { borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  list: { flex: 1, minHeight: 0, overflow: 'hidden' },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10 },
});

