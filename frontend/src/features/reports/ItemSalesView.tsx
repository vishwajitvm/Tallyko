/** Item-wise sales as a virtualised, searchable, sortable table (cards on phones), with totals and CSV export. */
import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import { Button, DataList, FilterBar, Text, type DataColumn, type DataListSort } from '@/components/ui';
import { money } from '@/lib/format';
import type { ItemRow } from './useReports';
import { filterItems, itemKey, itemTotals, shareLabel, sortItems } from './itemSales';

export function ItemSalesView({ rows, loading, error, onRetry, symbol, onExport, exporting, exportDisabled, onRefresh, refreshing }: {
  rows: ItemRow[] | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  symbol: string;
  onExport: () => void;
  exporting: boolean;
  exportDisabled: boolean;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const { colors } = useTheme();
  const { isPhone } = useLayout();
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<DataListSort>({ key: 'revenue', dir: 'desc' });
  const [footerW, setFooterW] = useState(0);

  const all = useMemo(() => rows ?? [], [rows]);
  const grand = useMemo(() => itemTotals(all), [all]);
  const list = useMemo(() => sortItems(filterItems(all, q), sort), [all, q, sort]);
  const totals = useMemo(() => itemTotals(list), [list]);

  const columns = useMemo<DataColumn<ItemRow>[]>(() => [
    { key: 'rank', title: '#', width: 48, numeric: true, value: (r) => String(list.indexOf(r) + 1) },
    {
      key: 'name', title: 'Item', flex: 2.4, minWidth: 160, sortable: true,
      render: (r) => (
        <Text variant="small" numberOfLines={1}>
          <Text variant="smallStrong">{r.name}</Text>{r.variant ? <Text variant="small" tone="muted"> · {r.variant}</Text> : null}
        </Text>
      ),
    },
    { key: 'qty', title: 'Qty', width: 80, numeric: true, sortable: true, value: (r) => r.quantity.toLocaleString('en-IN') },
    { key: 'revenue', title: 'Revenue', width: 120, numeric: true, sortable: true, render: (r) => <Text variant="smallStrong" style={styles.num}>{money(r.revenue, symbol)}</Text> },
    { key: 'share', title: 'Share', width: 72, numeric: true, hideBelow: 560, value: (r) => shareLabel(r.revenue, grand.revenue) },
    { key: 'tax', title: 'Tax', width: 100, numeric: true, sortable: true, hideBelow: 480, value: (r) => money(r.tax, symbol) },
  ], [list, symbol, grand.revenue]);

  const renderCard = (r: ItemRow) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="bodyStrong" numberOfLines={1}>{r.name}{r.variant ? <Text variant="small" tone="muted"> · {r.variant}</Text> : null}</Text>
        <Text variant="small" tone="muted" numberOfLines={1}>{r.quantity} sold · tax {money(r.tax, symbol)} · {shareLabel(r.revenue, grand.revenue)}</Text>
      </View>
      <Text variant="money">{money(r.revenue, symbol)}</Text>
    </View>
  );

  return (
    <View style={{ flex: 1, gap: 10, minHeight: 0 }}>
      <FilterBar onSearch={setQ} search={q} searchPlaceholder="Filter items" right={(
        <Button title={isPhone ? undefined : 'Export items'} icon="download-outline" variant="outline" onPress={onExport} loading={exporting}
          disabled={exportDisabled || !all.length} accessibilityLabel="Export item-wise sales as CSV" />
      )} />
      <View style={[styles.box, !isPhone && { borderWidth: 1, borderRadius: 14, borderColor: colors.border, backgroundColor: colors.surface }]}>
        <DataList<ItemRow>
          data={rows ? list : null}
          keyExtractor={itemKey}
          columns={columns}
          renderCard={renderCard}
          layout={isPhone ? 'cards' : 'auto'}
          tableMinWidth={480}
          cardHeight={64}
          loading={loading}
          error={error}
          onRetry={onRetry}
          refreshing={refreshing}
          onRefresh={onRefresh}
          sort={sort}
          onSortChange={setSort}
          empty={q ? { icon: 'search-outline', title: `No items match “${q}”` } : { icon: 'receipt-outline', title: 'No items sold in this period' }}
          testID="item-sales"
        />
        {list.length ? (
          // Same widths as the table columns so the totals line up (Qty 80, Revenue 120, Share 72, Tax 100)
          <View style={[styles.total, { borderTopColor: colors.border, backgroundColor: colors.surfaceAlt }]}
            onLayout={(e) => setFooterW(e.nativeEvent.layout.width)}>
            <Text variant="smallStrong" style={[styles.cell, { flex: 1, textAlign: 'left' }]} numberOfLines={1}>{q ? `Filtered: ${list.length} of ${all.length}` : `Total · ${all.length} items`}</Text>
            <Text variant="smallStrong" style={[styles.num, styles.cell, { width: 80 }]}>{totals.qty.toLocaleString('en-IN')}</Text>
            <Text variant="smallStrong" style={[styles.num, styles.cell, { width: 120 }]}>{money(totals.revenue, symbol)}</Text>
            {footerW >= 560 ? <Text variant="smallStrong" style={[styles.num, styles.cell, { width: 72 }]}>{shareLabel(totals.revenue, grand.revenue)}</Text> : null}
            {footerW >= 480 ? <Text variant="smallStrong" style={[styles.num, styles.cell, { width: 100 }]}>{money(totals.tax, symbol)}</Text> : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flex: 1, minHeight: 0, overflow: 'hidden' },
  num: { fontVariant: ['tabular-nums'] },
  total: { flexDirection: 'row', alignItems: 'center', minHeight: 44, borderTopWidth: 1 },
  cell: { paddingHorizontal: 10, textAlign: 'right' },
});
