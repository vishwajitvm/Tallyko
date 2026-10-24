/** Performance tab: who took and settled how much, ranked, for today / 7 days / 30 days. */
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { teamApi, type StaffPerformance } from '@/api/access';
import { Card, EmptyState, ErrorState, Loading, Segmented, Stat, Text } from '@/components/ui';
import { useApi } from '@/hooks/useApi';
import { money } from '@/lib/format';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import { Callout, ChoiceChips } from '../components';
import { Avatar, RANGE_OPTIONS, RoleBadge, Row, TableHead, cellStyle, localRange, roleName, type Column, type RangeKey, type StaffCtx } from './shared';

type SortKey = 'sales' | 'orders' | 'covers' | 'collected';
const SORTS: { value: SortKey; label: string }[] = [
  { value: 'sales', label: 'Sales' },
  { value: 'orders', label: 'Orders' },
  { value: 'covers', label: 'Covers' },
  { value: 'collected', label: 'Collected' },
];

const RANGE_TEXT: Record<RangeKey, string> = { today: 'today', '7d': 'in the last 7 days', '30d': 'in the last 30 days' };

export function PerformanceTab({ ctx, refreshKey }: { ctx: StaffCtx; refreshKey: number }) {
  const inPlan = ctx.hasFeature('advanced_reports');
  if (!inPlan) {
    return (
      <Card>
        <EmptyState icon="lock-closed-outline" title="Staff performance isn't in your plan"
          message="Waiter and cashier performance is part of Staff, item & wastage reports. Contact Tallyko to upgrade your plan." />
      </Card>
    );
  }
  return <Performance ctx={ctx} refreshKey={refreshKey} />;
}

function Performance({ ctx, refreshKey }: { ctx: StaffCtx; refreshKey: number }) {
  const { isPhone, width } = useLayout();
  const { colors } = useTheme();
  const [range, setRange] = useState<RangeKey>('today');
  const [sort, setSort] = useState<SortKey>('sales');
  const q = useApi(() => { const r = localRange(range); return teamApi.staffPerformance(r.from, r.to); }, [range, refreshKey]);

  const rows = useMemo(() => [...(q.data ?? [])].sort((a, b) => b[sort] - a[sort] || b.sales - a.sales), [q.data, sort]);
  const totals = useMemo(() => {
    const t = { sales: 0, orders: 0, covers: 0, collected: 0, settled: 0, cancelled: 0 };
    for (const r of q.data ?? []) {
      t.sales += r.sales; t.orders += r.orders; t.covers += r.covers; t.collected += r.collected; t.settled += r.bills_settled; t.cancelled += r.cancelled;
    }
    return t;
  }, [q.data]);
  const top = rows[0]?.[sort] || 0;
  const wide = width >= 1180;

  const columns: Column[] = [
    { key: 'rank', label: '#', width: 28 },
    { key: 'name', label: 'Staff', flex: 2.2 },
    { key: 'orders', label: 'Orders', flex: 0.8, align: 'right' },
    { key: 'sales', label: 'Sales', flex: 1.4, align: 'right' },
    { key: 'avg', label: 'Avg bill', flex: 1, align: 'right' },
    ...(wide ? [{ key: 'tables', label: 'Tables', flex: 0.8, align: 'right' } as Column] : []),
    { key: 'covers', label: 'Covers', flex: 0.8, align: 'right' },
    ...(wide ? [{ key: 'settled', label: 'Settled', flex: 0.8, align: 'right' } as Column] : []),
    { key: 'collected', label: 'Collected', flex: 1.2, align: 'right' },
    { key: 'cancelled', label: 'Cancelled', flex: 0.9, align: 'right' },
  ];
  const col = (key: string) => columns.find((c) => c.key === key)!;

  const name = (r: StaffPerformance) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 0 }}>
      <Avatar name={r.name} size={34} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text variant="bodyStrong" numberOfLines={1}>{r.name}</Text>
        {r.role ? <RoleBadge roleKey={r.role} label={roleName(r.role, ctx.roles)} /> : null}
      </View>
    </View>
  );

  const rank = (i: number) => i === 0 && top > 0
    ? <Ionicons name="trophy" size={18} color={colors.accent} accessibilityLabel="Top" />
    : <Text variant="smallStrong" tone="subtle">{i + 1}</Text>;

  const bar = (value: number) => (
    <View style={{ height: 4, width: '100%', maxWidth: 120, borderRadius: 2, backgroundColor: colors.surfaceSunken, overflow: 'hidden' }}>
      <View style={{ height: 4, width: `${top > 0 ? Math.max(4, (value / top) * 100) : 0}%`, backgroundColor: colors.primary }} />
    </View>
  );

  return (
    <View style={{ gap: 16 }}>
      <View style={{ flexDirection: isPhone ? 'column' : 'row', gap: 12, alignItems: isPhone ? 'stretch' : 'center', justifyContent: 'space-between' }}>
        <View style={{ minWidth: isPhone ? undefined : 300 }}>
          <Segmented size="sm" value={range} options={RANGE_OPTIONS} onChange={setRange} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Text variant="small" tone="muted">Rank by</Text>
          <ChoiceChips value={sort} options={SORTS} onChange={setSort} accessibilityLabel="Rank by" />
        </View>
      </View>

      {q.loading && !q.data ? <Loading label="Loading performance" /> : null}
      {q.error && !q.data ? <ErrorState message={q.error} onRetry={q.reload} /> : null}

      {q.data ? (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
            <Stat label="Sales taken" value={money(totals.sales, '₹', true)} icon="trending-up-outline" hint={`${totals.orders} order${totals.orders === 1 ? '' : 's'}`} />
            <Stat label="Average bill" value={money(totals.orders ? totals.sales / totals.orders : 0, '₹', true)} icon="receipt-outline" hint={totals.covers ? `${totals.covers} covers` : undefined} />
            <Stat label="Collected" value={money(totals.collected, '₹', true)} icon="wallet-outline" hint={`${totals.settled} bill${totals.settled === 1 ? '' : 's'} settled`} />
            <Stat label="Cancelled" value={String(totals.cancelled)} icon="close-circle-outline" tone={totals.cancelled ? 'danger' : 'default'} hint="bills" />
          </View>

          {rows.length === 0 ? (
            <Card>
              <EmptyState icon="podium-outline" title={`No completed bills ${RANGE_TEXT[range]}`}
                message="Staff appear here once they take or settle bills. Orders on a waiter's assigned tables count towards that waiter." />
            </Card>
          ) : (
            <Card padded={false} style={{ overflow: 'hidden' }}>
              {!isPhone ? <TableHead columns={columns} /> : null}
              {rows.map((r, i) => isPhone ? (
                <Row key={r.staff_id} first={i === 0} style={{ alignItems: 'flex-start' }}>
                  <View style={{ width: 22, paddingTop: 8, alignItems: 'center' }}>{rank(i)}</View>
                  <View style={{ flex: 1, minWidth: 0, gap: 10 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <View style={{ flex: 1, minWidth: 0 }}>{name(r)}</View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text variant="money">{money(r[sort === 'collected' ? 'collected' : 'sales'], '₹', true)}</Text>
                        <Text variant="caption" tone="subtle">{sort === 'collected' ? 'collected' : 'sales'}</Text>
                      </View>
                    </View>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 6 }}>
                      <Metric label="Orders" value={String(r.orders)} />
                      <Metric label="Avg bill" value={money(r.average_bill, '₹', true)} />
                      <Metric label="Covers" value={String(r.covers)} />
                      <Metric label="Tables" value={String(r.tables_served)} />
                      <Metric label="Settled" value={`${r.bills_settled} · ${money(r.collected, '₹', true)}`} />
                      <Metric label="Cancelled" value={String(r.cancelled)} danger={r.cancelled > 0} />
                    </View>
                  </View>
                </Row>
              ) : (
                <Row key={r.staff_id} first={i === 0}>
                  <View style={cellStyle(col('rank'))}>{rank(i)}</View>
                  <View style={cellStyle(col('name'))}>{name(r)}</View>
                  <View style={cellStyle(col('orders'))}><Text variant="money">{r.orders}</Text></View>
                  <View style={[cellStyle(col('sales')), { gap: 4 }]}>
                    <Text variant="money">{money(r.sales, '₹', true)}</Text>
                    {sort === 'sales' ? bar(r.sales) : null}
                  </View>
                  <View style={cellStyle(col('avg'))}><Text variant="small">{money(r.average_bill, '₹', true)}</Text></View>
                  {wide ? <View style={cellStyle(col('tables'))}><Text variant="small">{r.tables_served}</Text></View> : null}
                  <View style={[cellStyle(col('covers')), { gap: 4 }]}>
                    <Text variant="small">{r.covers}</Text>
                    {sort === 'covers' ? bar(r.covers) : null}
                  </View>
                  {wide ? <View style={cellStyle(col('settled'))}><Text variant="small">{r.bills_settled}</Text></View> : null}
                  <View style={[cellStyle(col('collected')), { gap: 4 }]}>
                    <Text variant="small">{money(r.collected, '₹', true)}</Text>
                    {sort === 'collected' ? bar(r.collected) : null}
                  </View>
                  <View style={cellStyle(col('cancelled'))}><Text variant="small" tone={r.cancelled ? 'danger' : 'subtle'}>{r.cancelled}</Text></View>
                </Row>
              ))}
            </Card>
          )}
          <Callout tone="neutral" icon="information-circle-outline">
            Sales, orders and covers count completed bills by the staff member who took the order. Collected counts bills they settled. Cancelled counts their orders that were cancelled.
          </Callout>
        </>
      ) : null}
    </View>
  );
}

function Metric({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <View style={{ width: '33.33%', paddingRight: 8 }}>
      <Text variant="caption" tone="subtle">{label}</Text>
      <Text variant="smallStrong" tone={danger ? 'danger' : 'default'} numberOfLines={1}>{value}</Text>
    </View>
  );
}
