import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import { Button, Chip, EmptyState, ErrorState, IconButton, Input, Screen, Segmented, Text, toast, useHotkeys } from '@/components/ui';
import { ItemSalesView } from './ItemSalesView';
import { useAuth, useRole, can } from '@/store/auth';
import { useData } from '@/store/data';
import type { SalesSummary } from '@/api/types';
import { CHANNEL_LABEL, ORDER_TYPE_LABEL, PAYMENT_LABEL, money } from '@/lib/format';
import { printHtml, PrinterError } from '@/lib/print/printers';
import { PRESETS, isSingleDay, presetRange, rangeDays, rangeLabel, rangeSlug, validateCustom, ymd, type ReportRange } from './range';
import { useReports, type ItemRow, type StaffRow, type WastageRow } from './useReports';
import { BarList, HourlyChart } from './charts';
import { Cell, DataTable, KpiGrid, Panel, PanelError, Skeleton, type Kpi } from './ui';
import { dayEndHtml, itemsCsv, summaryCsv } from './exportData';
import { saveTextFile } from './saveFile';

export default function ReportsScreen() {
  const role = useRole();
  if (!can(role, 'manage')) {
    return (
      <Screen title="Reports">
        <EmptyState icon="lock-closed-outline" title="Reports are for owners and managers"
          message="Sales reports show the whole business's takings, so they're limited to owners and managers. Ask your manager if you need today's numbers." />
      </Screen>
    );
  }
  return <ReportsBody />;
}

function ReportsBody() {
  const { colors } = useTheme();
  const { isPhone } = useLayout();
  const settings = useData((s) => s.settings);
  const session = useAuth((s) => s.session);
  const symbol = settings?.currency_symbol || '₹';
  const businessName = settings?.business_name || session?.businessName || 'Business';

  const [range, setRange] = useState<ReportRange>(() => presetRange('today'));
  const [customOpen, setCustomOpen] = useState(false);
  const [fromText, setFromText] = useState('');
  const [toText, setToText] = useState('');
  const [customErrors, setCustomErrors] = useState<{ from?: string; to?: string }>({});
  const [busy, setBusy] = useState<null | 'summary' | 'items' | 'print'>(null);
  const [contentWidth, setContentWidth] = useState(0);
  const [view, setView] = useState<'overview' | 'items'>('overview');

  const report = useReports(range);
  const summary = report.summary.data;
  const label = rangeLabel(range);
  const twoCol = contentWidth >= 760;

  const pickPreset = (id: (typeof PRESETS)[number]['id']) => {
    setCustomOpen(false);
    setCustomErrors({});
    setRange(presetRange(id));
  };
  // Desktop: 1-5 pick a date preset, I / O switch between the item table and the overview
  useHotkeys(Object.fromEntries([
    ...PRESETS.map((p, i) => [String(i + 1), () => pickPreset(p.id)]),
    ['i', () => setView('items')], ['o', () => setView('overview')],
  ]), []);

  const openCustom = () => {
    setFromText(ymd(range.start));
    setToText(ymd(new Date(range.end.getTime() - 86_400_000)));
    setCustomErrors({});
    setCustomOpen(true);
  };

  const applyCustom = () => {
    const r = validateCustom(fromText, toText);
    if (r.errors) {
      setCustomErrors(r.errors);
      return;
    }
    setCustomErrors({});
    setCustomOpen(false);
    setRange(r.range);
  };

  const exportSummary = async () => {
    if (!summary) return;
    setBusy('summary');
    try {
      await saveTextFile(`tallyko-summary-${rangeSlug(range)}.csv`,
        summaryCsv(summary, label, { staff: report.staff.data, wastage: report.wastage.data }));
      toast.success('Summary exported');
    } catch (e: any) {
      toast.error(e?.message || 'Could not export the summary.');
    } finally {
      setBusy(null);
    }
  };

  const exportItems = async () => {
    if (!report.items.data?.length) return;
    setBusy('items');
    try {
      await saveTextFile(`tallyko-items-${rangeSlug(range)}.csv`, itemsCsv(report.items.data, label));
      toast.success('Item-wise sales exported');
    } catch (e: any) {
      toast.error(e?.message || 'Could not export item-wise sales.');
    } finally {
      setBusy(null);
    }
  };

  const printDayEnd = async () => {
    if (!summary) return;
    setBusy('print');
    try {
      await printHtml(dayEndHtml(summary, {
        businessName, periodLabel: label, singleDay: isSingleDay(range), symbol, printedBy: session?.fullName || session?.email,
      }));
    } catch (e) {
      if (!(e instanceof PrinterError && e.code === 'CANCELLED')) toast.error(e instanceof Error && e.message ? e.message : 'Could not print the summary.');
    } finally {
      setBusy(null);
    }
  };

  const printLabel = isSingleDay(range) ? 'Day-end summary' : 'Print summary';
  const actions = isPhone ? (
    <>
      <IconButton icon="download-outline" accessibilityLabel="Export summary as CSV" variant="secondary" onPress={exportSummary} disabled={!summary || busy !== null} />
      <IconButton icon="print-outline" accessibilityLabel={printLabel} variant="secondary" onPress={printDayEnd} disabled={!summary || busy !== null} />
      <IconButton icon="refresh" accessibilityLabel="Refresh reports" variant="secondary" onPress={() => void report.reload()} disabled={report.refreshing || report.loading} />
    </>
  ) : (
    <>
      <Button title="Export CSV" icon="download-outline" variant="secondary" onPress={exportSummary} loading={busy === 'summary'} disabled={!summary || (busy !== null && busy !== 'summary')} />
      <Button title={printLabel} icon="print-outline" variant="secondary" onPress={printDayEnd} loading={busy === 'print'} disabled={!summary || (busy !== null && busy !== 'print')} />
      <IconButton icon="refresh" accessibilityLabel="Refresh reports" variant="secondary" onPress={() => void report.reload()} disabled={report.refreshing || report.loading} />
    </>
  );

  const viewSwitch = (
    <View style={{ width: isPhone ? '100%' : 260 }}>
      <Segmented<'overview' | 'items'> value={view} onChange={setView} options={[
        { value: 'overview', label: 'Overview', icon: 'stats-chart-outline' },
        { value: 'items', label: report.items.data ? `Items ${report.items.data.length}` : 'Items', icon: 'list-outline' },
      ]} />
    </View>
  );
  const toolbar = (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: isPhone ? 'column' : 'row', gap: 10, alignItems: isPhone ? 'stretch' : 'center' }}>
      {viewSwitch}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 1, flexShrink: 1 }} contentContainerStyle={{ gap: 8, paddingRight: 8, alignItems: 'center' }}>
        {PRESETS.map((p) => (
          <Chip key={p.id} label={p.label} selected={range.preset === p.id && !customOpen} onPress={() => pickPreset(p.id)} />
        ))}
        <Chip label={range.preset === 'custom' && !customOpen ? label : 'Custom'} icon="calendar-outline" selected={range.preset === 'custom' || customOpen}
          onPress={() => (customOpen ? setCustomOpen(false) : openCustom())} />
      </ScrollView>
      </View>
      {customOpen ? (
        <View style={[styles.custom, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Input label="From" value={fromText} onChangeText={(v) => { setFromText(v); setCustomErrors((e) => ({ ...e, from: undefined })); }}
            placeholder="YYYY-MM-DD" error={customErrors.from} containerStyle={styles.dateInput} maxLength={10} autoCorrect={false}
            keyboardType="numbers-and-punctuation" icon="calendar-outline" returnKeyType="next" />
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

  let body: React.ReactNode;
  if (report.loading && report.key === null) {
    body = <ReportsSkeleton twoCol={twoCol} />;
  } else if (!summary && report.summary.error) {
    body = <ErrorState message={report.summary.error} onRetry={() => void report.retry()} />;
  } else if (summary) {
    body = (
      <View style={{ gap: 16, opacity: report.loading ? 0.55 : 1 }}>
        <KpiGrid items={kpis(summary, symbol)} />
        {summary.orders === 0 ? (
          <Panel title="Sales" icon="bar-chart-outline">
            <EmptyState icon="receipt-outline" title={`No sales ${isSingleDay(range) && range.preset === 'today' ? 'yet today' : 'in this period'}`}
              message={summary.open_orders && range.end.getTime() > Date.now()
                ? `${summary.open_orders} order${summary.open_orders > 1 ? 's are' : ' is'} still open. Sales appear here once bills are settled.`
                : 'Completed bills will show up here with hourly sales, payment methods and top items.'} />
          </Panel>
        ) : (
          <SalesPanels summary={summary} symbol={symbol} twoCol={twoCol} narrow={contentWidth > 0 && contentWidth < 560} range={range} />
        )}
        {summary.orders > 0 ? (
          <ItemsPanel rows={report.items.data} error={report.items.error} symbol={symbol} onRetry={() => void report.retry()}
            onExport={exportItems} exporting={busy === 'items'} disabled={busy !== null && busy !== 'items'} onSeeAll={() => setView('items')} />
        ) : null}
        <Row twoCol={twoCol}>
          {summary.orders > 0 ? <StaffPanel rows={report.staff.data} error={report.staff.error} symbol={symbol} onRetry={() => void report.retry()} /> : null}
          <WastagePanel rows={report.wastage.data} error={report.wastage.error} symbol={symbol} onRetry={() => void report.retry()} />
        </Row>
      </View>
    );
  } else {
    body = <ReportsSkeleton twoCol={twoCol} />;
  }

  if (view === 'items') {
    return (
      <Screen title="Reports" subtitle={`${label} · item-wise sales`} actions={actions} toolbar={toolbar} scroll={false}
        contentStyle={{ flex: 1, paddingBottom: 16 }}>
        <ItemSalesView rows={report.items.data} loading={report.loading || (!report.items.data && !report.items.error)} error={report.items.error}
          onRetry={() => void report.retry()} symbol={symbol} onExport={exportItems} exporting={busy === 'items'}
          exportDisabled={busy !== null && busy !== 'items'} onRefresh={() => void report.reload()} refreshing={report.refreshing} />
      </Screen>
    );
  }

  return (
    <Screen title="Reports" subtitle={label} actions={actions} toolbar={toolbar} refreshing={report.refreshing} onRefresh={() => void report.reload()}>
      <View onLayout={(e) => setContentWidth(e.nativeEvent.layout.width)} style={{ gap: 16 }}>
        {body}
      </View>
    </Screen>
  );
}

function kpis(s: SalesSummary, symbol: string): Kpi[] {
  const m = (v: number) => money(v, symbol, true);
  const discountPct = s.gross_sales + s.discounts > 0 ? (s.discounts / (s.gross_sales + s.discounts)) * 100 : 0;
  return [
    { key: 'gross', label: 'Gross sales', value: m(s.gross_sales), hint: `${m(s.net_sales)} before GST`, icon: 'trending-up-outline', tone: 'primary' },
    { key: 'orders', label: 'Orders', value: s.orders.toLocaleString('en-IN'), hint: 'completed bills', icon: 'receipt-outline', tone: 'info' },
    { key: 'aov', label: 'Avg order', value: m(s.average_order_value), hint: 'per completed bill', icon: 'calculator-outline', tone: 'accent' },
    { key: 'gst', label: 'GST collected', value: m(s.tax), hint: 'CGST + SGST', icon: 'document-text-outline', tone: 'neutral' },
    { key: 'disc', label: 'Discounts', value: m(s.discounts), hint: discountPct ? `${discountPct.toFixed(1)}% of sales` : 'none given', icon: 'pricetag-outline', tone: 'warning' },
    { key: 'net', label: 'Net payout', value: m(s.gross_sales - s.commission), hint: s.commission ? `after ${m(s.commission)} commission` : 'no commission', icon: 'wallet-outline', tone: 'success' },
    { key: 'cancel', label: 'Cancelled', value: s.cancelled_orders.toLocaleString('en-IN'), hint: s.cancelled_orders ? `${m(s.cancelled_value)} cancelled` : 'none', icon: 'close-circle-outline', tone: 'danger' },
    { key: 'open', label: 'Open orders', value: s.open_orders.toLocaleString('en-IN'), hint: s.open_orders ? `${m(s.open_value)} unbilled now` : 'none right now', icon: 'hourglass-outline', tone: 'neutral' },
  ];
}

function Row({ twoCol, children }: { twoCol: boolean; children: React.ReactNode }) {
  const items = React.Children.toArray(children).filter(Boolean);
  if (!items.length) return null;
  if (!twoCol || items.length === 1) return <>{items.map((c, i) => <View key={i}>{c}</View>)}</>;
  return (
    <View style={{ flexDirection: 'row', gap: 16, alignItems: 'stretch' }}>
      {items.map((c, i) => <View key={i} style={{ flex: 1, minWidth: 0 }}>{c}</View>)}
    </View>
  );
}

function SalesPanels({ summary: s, symbol, twoCol, narrow, range }: { summary: SalesSummary; symbol: string; twoCol: boolean; narrow: boolean; range: ReportRange }) {
  const { colors } = useTheme();
  const days = rangeDays(range);
  const totalPayments = s.by_payment.reduce((n, p) => n + p.amount, 0);
  const channelTotals = s.by_channel.reduce((t, c) => ({ orders: t.orders + c.orders, amount: t.amount + c.amount, commission: t.commission + c.commission, net: t.net + c.net }),
    { orders: 0, amount: 0, commission: 0, net: 0 });
  const payments = [...s.by_payment].sort((a, b) => b.amount - a.amount);
  const types = [...s.by_type].sort((a, b) => b.amount - a.amount);
  const maxTop = Math.max(1, ...s.top_items.map((t) => t.revenue));

  return (
    <>
      <Panel title="Sales by hour" subtitle={days > 1 ? `Combined across ${days} days` : 'Completed bills, by the hour they were opened'} icon="time-outline">
        <HourlyChart hourly={s.hourly} symbol={symbol} />
      </Panel>

      <Row twoCol={twoCol}>
        <Panel title="Payment methods" subtitle={`${money(totalPayments, symbol, true)} received`} icon="card-outline" style={{ flex: 1 }}>
          <BarList symbol={symbol} emptyLabel="No payments recorded"
            data={payments.map((p) => ({ key: p.method, label: PAYMENT_LABEL[p.method] ?? p.method, value: p.amount, detail: `${p.count} payment${p.count === 1 ? '' : 's'}` }))} />
        </Panel>
        <Panel title="Order types" icon="restaurant-outline" style={{ flex: 1 }}>
          <BarList symbol={symbol}
            data={types.map((t) => ({ key: t.type, label: ORDER_TYPE_LABEL[t.type] ?? t.type, value: t.amount, detail: `${t.orders} order${t.orders === 1 ? '' : 's'}` }))} />
        </Panel>
      </Row>

      <Panel title="Channels" subtitle="Aggregator commission is deducted from the net payout" icon="git-branch-outline">
        {narrow ? (
          <View style={{ gap: 0 }}>
            {[...s.by_channel].sort((a, b) => b.amount - a.amount).map((c) => (
              <View key={c.channel} style={[styles.channelRow, { borderBottomColor: colors.divider }]}
                accessible accessibilityLabel={`${CHANNEL_LABEL[c.channel] ?? c.channel}: ${c.orders} orders, gross ${money(c.amount, symbol)}, commission ${money(c.commission, symbol)}, net ${money(c.net, symbol)}`}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text variant="smallStrong" numberOfLines={1}>{CHANNEL_LABEL[c.channel] ?? c.channel}</Text>
                  <Text variant="caption" tone="subtle" numberOfLines={1}>
                    {c.orders} order{c.orders === 1 ? '' : 's'} · gross {money(c.amount, symbol, true)}{c.commission ? ` · −${money(c.commission, symbol, true)} fee` : ''}
                  </Text>
                </View>
                <Text variant="smallStrong" style={{ fontVariant: ['tabular-nums'] }}>{money(c.net, symbol, true)}</Text>
              </View>
            ))}
            <View style={[styles.channelRow, { borderBottomWidth: 0 }]}>
              <Text variant="smallStrong" style={{ flex: 1 }}>Net total · {channelTotals.orders} orders</Text>
              <Text variant="smallStrong" style={{ fontVariant: ['tabular-nums'] }}>{money(channelTotals.net, symbol, true)}</Text>
            </View>
          </View>
        ) : (
          <DataTable minWidth={520} rows={[...s.by_channel].sort((a, b) => b.amount - a.amount)} rowKey={(r) => r.channel}
            columns={[
              { key: 'ch', label: 'Channel', flex: 1.6, render: (r) => <Cell strong>{CHANNEL_LABEL[r.channel] ?? r.channel}</Cell> },
              { key: 'o', label: 'Orders', align: 'right', render: (r) => <Cell align="right">{r.orders}</Cell> },
              { key: 'g', label: 'Gross', align: 'right', flex: 1.2, render: (r) => <Cell align="right">{money(r.amount, symbol, true)}</Cell> },
              { key: 'c', label: 'Commission', align: 'right', flex: 1.2, render: (r) => <Cell align="right" muted={!r.commission}>{r.commission ? `−${money(r.commission, symbol, true)}` : '—'}</Cell> },
              { key: 'n', label: 'Net', align: 'right', flex: 1.2, render: (r) => <Cell align="right" strong>{money(r.net, symbol, true)}</Cell> },
            ]}
            footer={[
              <Cell key="t" strong>Total</Cell>, <Cell key="o" align="right" strong>{channelTotals.orders}</Cell>,
              <Cell key="g" align="right" strong>{money(channelTotals.amount, symbol, true)}</Cell>,
              <Cell key="c" align="right" strong>{channelTotals.commission ? `−${money(channelTotals.commission, symbol, true)}` : '—'}</Cell>,
              <Cell key="n" align="right" strong>{money(channelTotals.net, symbol, true)}</Cell>,
            ]} />
        )}
      </Panel>

      <Row twoCol={twoCol}>
        <Panel title="Top items" subtitle="By revenue (before GST)" icon="trophy-outline" style={{ flex: 1 }}>
          {s.top_items.length ? (
            <View style={{ gap: 12 }}>
              {s.top_items.map((t, i) => (
                <View key={t.name} style={styles.topRow} accessible accessibilityLabel={`Rank ${i + 1}: ${t.name}, ${t.quantity} sold, ${money(t.revenue, symbol)}`}>
                  <View style={[styles.rank, { backgroundColor: i < 3 ? colors.primarySoft : colors.surfaceSunken }]}>
                    <Text variant="smallStrong" color={i < 3 ? colors.primary : colors.textMuted}>{i + 1}</Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <Text variant="smallStrong" numberOfLines={1} style={{ flex: 1 }}>{t.name}</Text>
                      <Text variant="smallStrong" style={{ fontVariant: ['tabular-nums'] }}>{money(t.revenue, symbol, true)}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <View style={[styles.miniTrack, { backgroundColor: colors.surfaceSunken }]}>
                        <View style={{ width: `${(t.revenue / maxTop) * 100}%`, height: '100%', borderRadius: 3, backgroundColor: colors.primary, opacity: 0.75 }} />
                      </View>
                      <Text variant="caption" tone="subtle" style={{ minWidth: 52, textAlign: 'right' }}>{t.quantity} sold</Text>
                    </View>
                  </View>
                </View>
              ))}
            </View>
          ) : <Text tone="subtle" variant="small">No items sold</Text>}
        </Panel>
        <Panel title="Category sales" subtitle="Revenue before GST" icon="albums-outline" style={{ flex: 1 }}>
          <BarList symbol={symbol}
            data={s.by_category.map((c) => ({ key: c.category, label: c.category, value: c.revenue, detail: `${c.quantity} sold` }))} />
        </Panel>
      </Row>
    </>
  );
}

const ITEMS_PREVIEW = 12;

function ItemsPanel({ rows, error, symbol, onRetry, onExport, exporting, disabled, onSeeAll }: {
  rows: ItemRow[] | null; error: string | null; symbol: string; onRetry: () => void; onExport: () => void; exporting: boolean; disabled: boolean;
  onSeeAll: () => void;
}) {
  // The overview shows the top sellers; every item is in the virtualised "Items" view
  const filtered = useMemo(() => [...(rows ?? [])].sort((a, b) => b.revenue - a.revenue), [rows]);
  const visible = filtered.slice(0, ITEMS_PREVIEW);
  const totals = filtered.reduce((t, r) => ({ qty: t.qty + r.quantity, revenue: t.revenue + r.revenue, tax: t.tax + r.tax }), { qty: 0, revenue: 0, tax: 0 });

  return (
    <Panel title="Item-wise sales" subtitle={rows ? `Top ${Math.min(ITEMS_PREVIEW, rows.length)} of ${rows.length} item${rows.length === 1 ? '' : 's'} sold` : undefined} icon="list-outline"
      actions={<Button title="Export CSV" size="sm" variant="secondary" icon="download-outline" onPress={onExport} loading={exporting} disabled={disabled || !rows?.length} />}>
      {error && !rows ? <PanelError message={error} onRetry={onRetry} /> : !rows ? <Skeleton height={120} /> : rows.length === 0 ? (
        <Text tone="subtle" variant="small">No items sold</Text>
      ) : (
        <View style={{ gap: 10 }}>
          <DataTable minWidth={460} rows={visible} rowKey={(r) => `${r.name}|${r.variant ?? ''}`}
            columns={[
              { key: 'name', label: 'Item', flex: 2.4, render: (r) => (
                <Text variant="small" numberOfLines={2}>
                  <Text variant="smallStrong">{r.name}</Text>{r.variant ? <Text variant="small" tone="muted"> · {r.variant}</Text> : null}
                </Text>
              ) },
              { key: 'qty', label: 'Qty', align: 'right', flex: 0.7, render: (r) => <Cell align="right">{r.quantity}</Cell> },
              { key: 'rev', label: 'Revenue', align: 'right', flex: 1.2, render: (r) => <Cell align="right" strong>{money(r.revenue, symbol)}</Cell> },
              { key: 'tax', label: 'Tax', align: 'right', render: (r) => <Cell align="right" muted>{money(r.tax, symbol)}</Cell> },
            ]}
            footer={[
              <Cell key="t" strong>{filtered.length > ITEMS_PREVIEW ? `All ${filtered.length} items` : 'Total'}</Cell>, <Cell key="q" align="right" strong>{totals.qty}</Cell>,
              <Cell key="r" align="right" strong>{money(totals.revenue, symbol)}</Cell>, <Cell key="x" align="right" strong>{money(totals.tax, symbol)}</Cell>,
            ]} />
          {filtered.length > ITEMS_PREVIEW ? (
            <Button title={`See all ${filtered.length} items`} variant="tonal" iconRight="arrow-forward" onPress={onSeeAll} style={{ alignSelf: 'center' }} />
          ) : null}
        </View>
      )}
    </Panel>
  );
}

function StaffPanel({ rows, error, symbol, onRetry }: { rows: StaffRow[] | null; error: string | null; symbol: string; onRetry: () => void }) {
  const sorted = [...(rows ?? [])].sort((a, b) => b.amount - a.amount);
  return (
    <Panel title="Staff performance" subtitle="Completed bills by the person who created them" icon="people-outline" style={{ flex: 1 }}>
      {error && !rows ? <PanelError message={error} onRetry={onRetry} /> : !rows ? <Skeleton height={80} /> : sorted.length === 0 ? (
        <Text tone="subtle" variant="small">No bills in this period</Text>
      ) : (
        <DataTable rows={sorted} rowKey={(r, i) => r.user_id ?? `sys${i}`}
          columns={[
            { key: 'n', label: 'Staff', flex: 1.6, render: (r) => <Cell strong>{r.name}</Cell> },
            { key: 'o', label: 'Bills', align: 'right', flex: 0.7, render: (r) => <Cell align="right">{r.orders}</Cell> },
            { key: 'a', label: 'Sales', align: 'right', flex: 1.1, render: (r) => <Cell align="right" strong>{money(r.amount, symbol, true)}</Cell> },
            { key: 'v', label: 'Avg', align: 'right', render: (r) => <Cell align="right" muted>{money(r.orders ? r.amount / r.orders : 0, symbol, true)}</Cell> },
          ]} />
      )}
    </Panel>
  );
}

function WastagePanel({ rows, error, symbol, onRetry }: { rows: WastageRow[] | null; error: string | null; symbol: string; onRetry: () => void }) {
  const sorted = [...(rows ?? [])].sort((a, b) => b.cost - a.cost);
  const total = sorted.reduce((n, r) => n + r.cost, 0);
  return (
    <Panel title="Wastage" subtitle="Stock written off as wasted, at cost price" icon="trash-bin-outline" style={{ flex: 1 }}>
      {error && !rows ? <PanelError message={error} onRetry={onRetry} /> : !rows ? <Skeleton height={80} /> : sorted.length === 0 ? (
        <Text tone="subtle" variant="small">No wastage recorded in this period</Text>
      ) : (
        <DataTable rows={sorted} rowKey={(r) => r.product}
          columns={[
            { key: 'p', label: 'Item', flex: 1.8, render: (r) => <Cell strong>{r.product}</Cell> },
            { key: 'q', label: 'Qty', align: 'right', flex: 0.7, render: (r) => <Cell align="right">{r.quantity}</Cell> },
            { key: 'c', label: 'Cost', align: 'right', render: (r) => <Cell align="right">{money(r.cost, symbol)}</Cell> },
          ]}
          footer={[<Cell key="t" strong>Total</Cell>, <Cell key="q" align="right"> </Cell>, <Cell key="c" align="right" strong>{money(total, symbol)}</Cell>]} />
      )}
    </Panel>
  );
}

function ReportsSkeleton({ twoCol }: { twoCol: boolean }) {
  const { colors, radius } = useTheme();
  const card = (h: number, key: string) => (
    <View key={key} style={{ flex: 1, minWidth: 0, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface, padding: 16, gap: 14 }}>
      <Skeleton width="40%" height={16} />
      <Skeleton height={h} />
    </View>
  );
  return (
    <View style={{ gap: 16 }} accessibilityLabel="Loading reports">
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        {Array.from({ length: twoCol ? 8 : 4 }).map((_, i) => (
          <View key={i} style={{ width: twoCol ? '23.5%' : '48%', borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface, padding: 16, gap: 10 }}>
            <Skeleton width="60%" height={12} />
            <Skeleton width="75%" height={26} />
            <Skeleton width="45%" height={10} />
          </View>
        ))}
      </View>
      {card(200, 'chart')}
      <View style={{ flexDirection: twoCol ? 'row' : 'column', gap: 16 }}>
        {card(120, 'a')}
        {card(120, 'b')}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  custom: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, alignItems: 'flex-start', padding: 14, borderRadius: 14, borderWidth: 1 },
  dateInput: { flexGrow: 1, flexBasis: 160 },
  customActions: { flexDirection: 'row', gap: 8, alignSelf: 'flex-end', paddingBottom: 1 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rank: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  miniTrack: { flex: 1, height: 6, borderRadius: 3, overflow: 'hidden' },
  channelRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1 },
});
