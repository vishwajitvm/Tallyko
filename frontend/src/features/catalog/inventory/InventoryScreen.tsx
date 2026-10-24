/**
 * Inventory for big shops (docs/20_High_Volume_UX.md): a virtualised list with low / out-of-stock filters and
 * counts, one-tap stock in / out with a quantity stepper on every row, reasons (wastage, returns, counted
 * quantity) in an ActionMenu, and barcode lookup by camera or a USB / Bluetooth scanner typing anywhere.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, type Href } from 'expo-router';
import { inventoryApi } from '@/api/endpoints';
import { errorMessage } from '@/api/client';
import type { StockRow } from '@/api/types';
import { useApi } from '@/hooks/useApi';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import {
  ActionMenu, Button, DataList, FilterBar, IconButton, Screen, StatusPill, Text, toast,
  type ActionMenuItem, type DataColumn, type FilterOption,
} from '@/components/ui';
import { can, useRole } from '@/store/auth';
import { useData } from '@/store/data';
import { money } from '@/lib/format';
import { NoAccess } from '../components';
import { plural } from '../utils';
import { BarcodeScanSheet } from '../BarcodeScanSheet';
import { StockActionSheet, type StockAction } from './StockActionSheet';
import { StockHistorySheet } from './StockHistorySheet';
import { applyStockChange, clampQty, createScanBuffer, filterStock, stockCounts, type StockFilter } from './stockLogic';

type Reason = 'restock' | 'wastage' | 'adjustment' | 'return';
const WASTE = ['Expired', 'Damaged', 'Spilled / spoiled', 'Staff meal'] as const;

export function InventoryScreen() {
  const role = useRole();
  if (!can(role, 'manage')) {
    return (
      <Screen title="Inventory">
        <NoAccess title="Only owners and managers can manage stock" message="Ask your owner or manager to add stock or record wastage." />
      </Screen>
    );
  }
  return <Inventory />;
}

function Inventory() {
  const { colors } = useTheme();
  const { isPhone, isDesktop } = useLayout();
  const settings = useData((s) => s.settings);
  const categories = useData((s) => s.categories);
  const catalogProducts = useData((s) => s.products);
  const symbol = settings?.currency_symbol || '₹';
  const { data, setData, error, loading, refreshing, reload, silentReload } = useApi(() => inventoryApi.list());
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<StockFilter>('all');
  const [qty, setQty] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [action, setAction] = useState<{ row: StockRow; action: StockAction } | null>(null);
  const [history, setHistory] = useState<StockRow | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [flash, setFlash] = useState<string[]>([]);

  const rows = data ?? [];
  const catName = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);
  const nameOf = useCallback((id: string | null) => (id ? catName.get(id) ?? null : null), [catName]);
  const counts = useMemo(() => stockCounts(rows), [rows]);
  const value = useMemo(() => rows.reduce((s, r) => s + (r.stock_value || 0), 0), [rows]);
  const missingCost = useMemo(() => rows.filter((r) => r.cost_price === null && r.stock > 0).length, [rows]);
  const visible = useMemo(() => filterStock(rows, filter, query, nameOf), [rows, filter, query, nameOf]);

  const replaceRow = (next: StockRow) => setData((prev) => (prev ?? []).map((r) => (r.id === next.id ? next : r)));
  const qtyOf = (id: string) => qty[id] ?? 1;

  /**
   * One-tap stock change: the row updates at once, the server confirms in the background, and the toast offers
   * Undo (docs/20 §1.4), which records the opposite adjustment (stock history keeps both).
   */
  const quickRef = useRef<(row: StockRow, change: number, reason: Reason, note: string, undoable?: boolean) => Promise<void>>(async () => {});
  const quick = useCallback(async (row: StockRow, change: number, reason: Reason, note: string, undoable = true) => {
    if (busy[row.id]) return;
    setBusy((b) => ({ ...b, [row.id]: true }));
    const unit = row.unit || 'pcs';
    const after = applyStockChange(row, change);
    replaceRow(after);
    try {
      await inventoryApi.adjust({ product_id: row.id, quantity: change, reason, note });
      const message = `${row.name}: ${row.stock} → ${row.stock + change} ${unit}${reason === 'wastage' ? ` (${note})` : ''}`;
      if (undoable) toast.undo(message, () => void quickRef.current(after, -change, 'adjustment', `Undo: ${note}`, false));
      else toast.success(message);
    } catch (e) {
      replaceRow(row);
      toast.error(errorMessage(e));
    } finally {
      setBusy((b) => ({ ...b, [row.id]: false }));
    }
  }, [busy]); // eslint-disable-line react-hooks/exhaustive-deps
  quickRef.current = quick;

  const menuFor = useCallback((row: StockRow): ActionMenuItem[] => {
    const n = qty[row.id] ?? 1;
    const unit = row.unit || 'pcs';
    return [
      { key: 'in', label: `Stock in ${n} ${unit}`, icon: 'add-circle-outline', group: 'in', onPress: () => void quick(row, n, 'restock', 'Stock in') },
      { key: 'cost', label: 'Stock in with cost…', icon: 'receipt-outline', description: 'Supplier bill, cost per unit', group: 'in', onPress: () => setAction({ row, action: 'restock' }) },
      { key: 'return', label: `Customer return +${n}`, icon: 'return-down-back-outline', group: 'in', onPress: () => void quick(row, n, 'return', 'Customer return') },
      ...WASTE.map((w) => ({
        key: `w-${w}`, label: `Wastage −${n}: ${w}`, icon: 'trash-outline' as const, group: 'waste', onPress: () => void quick(row, -n, 'wastage', w),
      })),
      { key: 'waste', label: 'Wastage with a note…', icon: 'create-outline', group: 'waste', onPress: () => setAction({ row, action: 'wastage' }) },
      { key: 'count', label: 'Set counted quantity…', icon: 'swap-vertical-outline', description: 'After a stock count', group: 'fix', onPress: () => setAction({ row, action: 'adjust' }) },
      { key: 'history', label: 'Stock history', icon: 'time-outline', group: 'fix', onPress: () => setHistory(row) },
    ];
  }, [qty, quick]);

  // --- barcode lookup: camera sheet, or a hardware scanner typing anywhere on the page (web) ---
  const onScanned = useCallback((code: string) => {
    setScanOpen(false);
    const hit = rows.find((r) => (r.barcode ?? '') === code);
    if (hit) {
      setFilter('all');
      setQuery(code);
      setFlash([hit.id]);
      toast.success(`${hit.name}: ${hit.stock} ${hit.unit || 'pcs'} in stock`);
      return;
    }
    const product = catalogProducts.find((p) => p.barcode === code);
    if (product) toast.warning(`“${product.name}” isn’t tracked. Turn on “Track stock” for it in Menu & items.`);
    else toast.warning(`No item has barcode ${code}.`);
  }, [rows, catalogProducts]);

  const scanRef = useRef(onScanned);
  scanRef.current = onScanned;
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return undefined;
    const feed = createScanBuffer();
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return; // the search box handles its own input
      const code = feed(e.key, e.timeStamp || Date.now());
      if (code) { e.preventDefault(); scanRef.current(code); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    if (!flash.length) return undefined;
    const t = setTimeout(() => setFlash([]), 4000);
    return () => clearTimeout(t);
  }, [flash]);

  // --- list ---
  const stockCell = (r: StockRow) => {
    const unit = r.unit || 'pcs';
    return (
      <View style={styles.stockCell}>
        <Text variant="money" tone={r.stock < 0 ? 'danger' : r.stock === 0 ? 'danger' : r.is_low ? 'warning' : 'default'} numberOfLines={1}>{r.stock} {unit}</Text>
      </View>
    );
  };
  const statusOf = (r: StockRow) => (r.stock <= 0
    ? <StatusPill status="lapsed" label="Out of stock" />
    : r.is_low ? <StatusPill status="pending" label="Low" /> : <StatusPill status="active" label="OK" showIcon={false} />);

  const columns = useMemo<DataColumn<StockRow>[]>(() => [
    {
      key: 'name', title: 'Item', flex: 2, minWidth: 160,
      render: (r) => (
        <View style={{ minWidth: 0 }}>
          <Text variant="bodyStrong" numberOfLines={1}>{r.name}</Text>
          <Text variant="caption" tone="subtle" numberOfLines={1}>{[nameOf(r.category_id), r.barcode].filter(Boolean).join(' · ') || ' '}</Text>
        </View>
      ),
    },
    { key: 'stock', title: 'In stock', width: 96, numeric: true, render: stockCell },
    { key: 'status', title: 'Status', width: 120, hideBelow: 440, render: statusOf },
    { key: 'alert', title: 'Alert at', width: 76, numeric: true, hideBelow: 760, value: (r) => String(r.low_stock_threshold) },
    { key: 'value', title: 'Value', width: 100, numeric: true, hideBelow: 680, value: (r) => money(r.stock_value, symbol, true) },
  ], [nameOf, symbol]); // eslint-disable-line react-hooks/exhaustive-deps

  const quickControls = (r: StockRow, compact: boolean) => (
    <View style={styles.quick}>
      <QtyStepper value={qtyOf(r.id)} onChange={(v) => setQty((q) => ({ ...q, [r.id]: v }))} label={r.name} compact={compact} />
      <Button title="In" icon="add" size="sm" variant="tonal" onPress={() => void quick(r, qtyOf(r.id), 'restock', 'Stock in')} disabled={!!busy[r.id]}
        accessibilityLabel={`Stock in ${qtyOf(r.id)} ${r.unit || 'pcs'} of ${r.name}`} />
      <Button title="Out" icon="remove" size="sm" variant="outline" onPress={() => void quick(r, -qtyOf(r.id), 'adjustment', 'Stock out')} disabled={!!busy[r.id]}
        accessibilityLabel={`Stock out ${qtyOf(r.id)} ${r.unit || 'pcs'} of ${r.name}`} />
      <ActionMenu items={menuFor(r)} align="end" title={r.name}
        trigger={(open) => <IconButton icon="ellipsis-horizontal" accessibilityLabel={`More stock actions for ${r.name}`} onPress={open} />} />
    </View>
  );

  const renderCard = (r: StockRow) => (
    <View style={{ gap: 8 }}>
      <View style={styles.cardTop}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="bodyStrong" numberOfLines={1}>{r.name}</Text>
          <Text variant="caption" tone="subtle" numberOfLines={1}>{[nameOf(r.category_id), r.barcode].filter(Boolean).join(' · ') || 'No category'}</Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 2 }}>
          {stockCell(r)}
          {r.is_low ? statusOf(r) : <Text variant="caption" tone="subtle">Alert at {r.low_stock_threshold}</Text>}
        </View>
      </View>
      {quickControls(r, true)}
    </View>
  );

  const summary = rows.length ? (
    <View style={[styles.summary, { borderColor: colors.border, backgroundColor: colors.surface }]}>
      <Ionicons name="cube-outline" size={16} color={colors.textMuted} />
      <Text variant="small" tone="muted" style={{ flex: 1 }} numberOfLines={2}>
        <Text variant="smallStrong">{plural(rows.length, 'item')}</Text> tracked ·{' '}
        <Text variant="smallStrong" tone={counts.low ? 'warning' : 'default'}>{counts.low} low</Text>
        {counts.out ? <Text variant="smallStrong" tone="danger">{` (${counts.out} out)`}</Text> : null} · Stock value{' '}
        <Text variant="smallStrong">{money(value, symbol, true)}</Text>
        {missingCost ? ` · ${plural(missingCost, 'item')} without cost price` : ''}
      </Text>
    </View>
  ) : null;

  const filters: FilterOption[] = [
    { key: 'all', label: 'All', count: counts.all },
    { key: 'low', label: 'Low stock', icon: 'alert-circle-outline', count: counts.low },
    { key: 'out', label: 'Out of stock', count: counts.out },
  ];
  const toolbar = (
    <FilterBar onSearch={setQuery} search={query} searchPlaceholder="Search item, barcode or category" filters={filters} value={filter}
      onChange={(k) => setFilter(k as StockFilter)}
      right={(
        <>
          <Button title={isPhone ? undefined : 'Scan'} icon="barcode-outline" variant="outline" onPress={() => setScanOpen(true)} accessibilityLabel="Find an item by scanning its barcode" />
          {isPhone ? null : <IconButton icon="refresh" variant="secondary" accessibilityLabel="Refresh stock" onPress={reload} loading={refreshing} />}
        </>
      )} />
  );

  const goMenu = () => router.navigate('/menu' as Href);
  const noneTracked = !!data && rows.length === 0;

  return (
    <Screen
      title="Inventory"
      subtitle={rows.length ? `${plural(rows.length, 'item')} tracked${counts.low ? ` · ${counts.low} low` : ''}` : 'Stock levels, restocks and wastage'}
      toolbar={noneTracked ? undefined : toolbar}
      scroll={false}
      contentStyle={{ flex: 1, paddingBottom: 16, gap: 10 }}
      maxWidth={isDesktop ? 1680 : 1280}
    >
      {isPhone ? null : summary}
      <View style={[styles.list, !isPhone && { borderWidth: 1, borderRadius: 14, borderColor: colors.border, backgroundColor: colors.surface }]}>
        <DataList<StockRow>
          data={data}
          keyExtractor={(r) => r.id}
          columns={columns}
          layout={isPhone ? 'cards' : 'table'}
          renderCard={renderCard}
          cardHeight={112}
          rowHeight={isDesktop ? 52 : 60}
          loading={loading}
          error={error}
          onRetry={reload}
          refreshing={refreshing}
          onRefresh={reload}
          rowActions={isPhone ? undefined : (r) => quickControls(r, false)}
          rowActionsWidth={isDesktop ? 330 : 300}
          highlightKeys={flash}
          extraData={[qty, busy]}
          ListHeaderComponent={isPhone ? summary : null}
          empty={noneTracked ? {
            icon: 'cube-outline',
            title: 'No items are tracked yet',
            message: 'Open an item in Menu & items and turn on “Track stock”. Sales then reduce stock automatically and you get low-stock alerts here.',
            action: { label: 'Open Menu & items', icon: 'fast-food-outline', onPress: goMenu },
          } : {
            icon: query ? 'search-outline' : 'checkmark-circle-outline',
            title: query ? 'No items match your search' : filter === 'out' ? 'Nothing is out of stock' : 'Nothing is low on stock',
            action: { label: 'Show all', icon: 'list-outline', onPress: () => { setFilter('all'); setQuery(''); } },
          }}
          testID="stock-list"
        />
      </View>
      {action ? (
        <StockActionSheet key={`${action.row.id}-${action.action}`} row={action.row} action={action.action} symbol={symbol}
          onClose={() => setAction(null)} onDone={() => void silentReload()} />
      ) : null}
      {history ? <StockHistorySheet row={history} onClose={() => setHistory(null)} /> : null}
      <BarcodeScanSheet visible={scanOpen} onClose={() => setScanOpen(false)} onScanned={onScanned} />
    </Screen>
  );
}

/** Compact − qty + stepper (44 px targets on touch). Long-press ± jumps by 10. */
function QtyStepper({ value, onChange, label, compact }: { value: number; onChange: (v: number) => void; label: string; compact: boolean }) {
  const { colors, radius } = useTheme();
  const size = compact ? 44 : 36;
  const btn = (icon: 'remove' | 'add', delta: number) => {
    const disabled = delta < 0 && value <= 1;
    return (
      <Pressable
        onPress={() => onChange(clampQty(value + delta))}
        onLongPress={() => onChange(clampQty(value + delta * 10))}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={`${delta < 0 ? 'Less' : 'More'} for ${label}`}
        hitSlop={4}
        style={({ hovered }: any) => [
          { width: size, height: size, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, opacity: disabled ? 0.35 : 1 },
          hovered && !disabled ? { backgroundColor: colors.surfaceSunken } : null,
          Platform.OS === 'web' && ({ cursor: disabled ? 'not-allowed' : 'pointer' } as any),
        ]}
      >
        <Ionicons name={icon} size={16} color={colors.text} />
      </Pressable>
    );
  };
  return (
    <View style={[styles.stepper, { borderColor: colors.border, borderRadius: radius.md, height: size + 2 }]} accessibilityLabel={`Quantity ${value}`}>
      {btn('remove', -1)}
      <Text variant="bodyStrong" style={styles.stepValue}>{value}</Text>
      {btn('add', 1)}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, minHeight: 0, overflow: 'hidden' },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 8 },
  stockCell: { alignItems: 'flex-end' },
  quick: { flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'flex-end' },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepper: { flexDirection: 'row', alignItems: 'center', borderWidth: 1 },
  stepValue: { minWidth: 30, textAlign: 'center', fontVariant: ['tabular-nums'] },
});
