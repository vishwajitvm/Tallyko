/**
 * Customers for busy shops (tens of thousands of customers): server-paged, searched, sorted and tier-filtered
 * (GET /crm/customers?q&limit&offset&sort&tier, total in X-Total-Count, tier counts in X-Counts),
 * a virtualised DataList (table on wide screens, cards on phones) and the profile in a side panel (full screen on phones).
 */
import React, { useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { crmApi, type CustomerTierCounts } from '@/api/endpoints';
import type { Customer } from '@/api/types';
import { usePagedList } from '@/hooks/usePagedList';
import {
  ActionMenu, Badge, Button, DataList, EmptyState, FilterBar, Screen, Text,
  type ActionMenuItem, type DataColumn, type DataListSort, type FilterOption,
} from '@/components/ui';
import { can, useAuth } from '@/store/auth';
import { useData } from '@/store/data';
import { money } from '@/lib/format';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import { formatMobile } from '@/features/settings/validation';
import { DetailPanel } from '@/features/catalog/DetailPanel';
import { CustomerDetail, TIER_TONE, initials } from './CustomerDetail';
import { CustomerFormSheet } from './CustomerForm';
import {
  filterCustomers, lastVisitLabel, searchCached, serverSort, serverSortDir, sortCustomers, type CustomerSort, type TierFilter,
} from './paging';

const PAGE = 100;

const SORTS: { value: CustomerSort; label: string }[] = [
  { value: 'recent', label: 'Recent visit' },
  { value: 'spend', label: 'Top spend' },
  { value: 'visits', label: 'Most visits' },
  { value: 'points', label: 'Most points' },
  { value: 'name', label: 'Name' },
];

export default function CustomersScreen() {
  const role = useAuth((s) => s.session?.role ?? null);
  if (!can(role, 'order')) {
    return (
      <Screen title="Customers">
        <EmptyState icon="lock-closed-outline" title="Not available for kitchen logins" message="Ask a cashier or manager to look up customers." />
      </Screen>
    );
  }
  return <Customers />;
}

/**
 * Server-paged customers: search, sort, tier and "Email offers OK" are filtered on the server, with counts for every
 * chip. Falls back to the device cache when the first page can't load (offline).
 */
function useCustomerPages(q: string, tier: TierFilter, sortKey: string) {
  const serverTier = tier === 'Gold' || tier === 'Silver' || tier === 'Bronze' ? tier : null;
  const sort = serverSort(sortKey);
  const pages = usePagedList<Customer>(async (offset, limit) => {
    const page = await crmApi.page({ q: q || undefined, limit, offset, sort, tier: serverTier, opted_in: tier === 'optin' ? true : null });
    return { items: page.items, total: page.total, meta: page.counts };
  }, `${q}|${serverTier}|${tier === 'optin'}|${sort}`, { pageSize: PAGE, idOf: (c) => c.id });
  return {
    ...pages,
    /** First page answered (total known). */
    loaded: pages.total !== null,
    counts: (pages.meta ?? null) as CustomerTierCounts | null,
  };
}

function Customers() {
  const { colors } = useTheme();
  const { isPhone, isDesktop } = useLayout();
  const role = useAuth((s) => s.session?.role ?? null);
  const manager = can(role, 'manage');
  const cached = useData((s) => s.customers);
  const [q, setQ] = useState('');
  const [tier, setTier] = useState<TierFilter>('all');
  const [sort, setSort] = useState<DataListSort>({ key: 'recent', dir: 'desc' });
  const [selected, setSelected] = useState<Customer | null>(null);
  const [form, setForm] = useState<{ customer: Customer | null } | null>(null);
  const pages = useCustomerPages(q, tier, sort.key);
  const [listWidth, setListWidth] = useState(0);
  const tableMode = !isPhone && (listWidth || 9999) >= 560;

  // Offline (first page failed): fall back to the customers cached on this device, filtered and sorted here
  const offline = !!pages.error && !pages.loaded;
  const rows = useMemo(() => {
    if (offline) return sortCustomers(filterCustomers(searchCached(cached, q), tier), sort.key as CustomerSort, sort.dir);
    return pages.items; // server order and filters
  }, [offline, cached, q, tier, sort, pages.items]);

  // Tier counts come from the server for the whole search (not just the loaded pages)
  const offlineCount = (t: TierFilter) => (offline ? filterCustomers(searchCached(cached, q), t).length : undefined);
  const counts = pages.counts;
  const filters: FilterOption[] = [
    { key: 'all', label: 'All', count: offline ? offlineCount('all') : counts?.all },
    { key: 'Gold', label: 'Gold', count: offline ? offlineCount('Gold') : counts?.Gold },
    { key: 'Silver', label: 'Silver', count: offline ? offlineCount('Silver') : counts?.Silver },
    { key: 'Bronze', label: 'Bronze', count: offline ? offlineCount('Bronze') : counts?.Bronze },
    { key: 'optin', label: 'Email offers OK', icon: 'mail-outline', count: offline ? offlineCount('optin') : counts?.opted_in },
  ];

  // The server sorts each key one way (name A→Z, the rest highest / latest first)
  const changeSort = useCallback((s: DataListSort) => setSort({ key: s.key, dir: serverSortDir(s.key) }), []);
  const sortMenu: ActionMenuItem[] = SORTS.map((s) => ({
    key: s.value, label: s.label, selected: sort.key === s.value, icon: 'swap-vertical-outline',
    onPress: () => changeSort({ key: s.value, dir: serverSortDir(s.value) }),
  }));
  const sortLabel = SORTS.find((s) => s.value === sort.key)?.label ?? 'Sort';

  const onSaved = (c: Customer) => {
    pages.setItems((prev) => (prev.some((x) => x.id === c.id) ? prev.map((x) => (x.id === c.id ? c : x)) : [c, ...prev]));
    setSelected(c);
    setForm(null);
  };

  const avatar = (c: Customer, size = 32) => (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
      <Text variant="caption" color={colors.primarySoftText}>{initials(c.name)}</Text>
    </View>
  );
  const consent = (c: Customer) => (c.marketing_opt_in
    ? <Badge label="Email OK" tone="success" icon="mail-outline" />
    : <Text variant="small" tone="subtle">—</Text>);

  const columns = useMemo<DataColumn<Customer>[]>(() => [
    {
      key: 'name', title: 'Customer', flex: 2, minWidth: 170, sortable: true,
      render: (c) => (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 0 }}>
          {avatar(c, 28)}
          <Text variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>{c.name}</Text>
        </View>
      ),
    },
    { key: 'phone', title: 'Phone', width: 130, value: (c) => formatMobile(c.phone) },
    { key: 'tier', title: 'Tier', width: 86, hideBelow: 700, render: (c) => <Badge label={c.tier} tone={TIER_TONE[c.tier]} /> },
    { key: 'points', title: 'Points', width: 76, numeric: true, sortable: true, value: (c) => c.points.toLocaleString('en-IN') },
    { key: 'visits', title: 'Visits', width: 70, numeric: true, sortable: true, value: (c) => c.visits.toLocaleString('en-IN') },
    { key: 'spend', title: 'Spent', width: 110, numeric: true, sortable: true, hideBelow: 540, value: (c) => money(c.total_spent, '₹', true) },
    { key: 'recent', title: 'Last visit', width: 104, sortable: true, hideBelow: 860, value: (c) => lastVisitLabel(c.last_visit_at) },
    { key: 'consent', title: 'Offers', width: 104, hideBelow: 980, render: consent },
  ], [colors]); // eslint-disable-line react-hooks/exhaustive-deps

  const renderCard = useCallback((c: Customer) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      {avatar(c, 36)}
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>{c.name}</Text>
          {c.marketing_opt_in ? <Ionicons name="mail" size={13} color={colors.successText} accessibilityLabel="Agreed to email offers" /> : null}
        </View>
        <Text variant="small" tone="muted" numberOfLines={1}>
          {formatMobile(c.phone)} · {c.visits} visit{c.visits === 1 ? '' : 's'} · {lastVisitLabel(c.last_visit_at)}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 4 }}>
        <Text variant="money">{money(c.total_spent, '₹', true)}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text variant="caption" tone="subtle">{c.points} pts</Text>
          <Badge label={c.tier} tone={TIER_TONE[c.tier]} />
        </View>
      </View>
    </View>
  ), [colors]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = offline ? rows.length : pages.total ?? 0;
  const subtitle = pages.loaded || offline
    ? q ? `${shown.toLocaleString('en-IN')} found for “${q}”` : `${shown.toLocaleString('en-IN')} customer${shown === 1 ? '' : 's'}${tier !== 'all' ? ` · ${tier === 'optin' ? 'email offers OK' : tier}` : ''}`
    : undefined;

  const empty = q || tier !== 'all'
    ? {
      icon: 'search-outline' as const, title: 'No matching customers',
      message: q ? `Nobody matches “${q}”. Check the spelling or search by phone number.` : 'No customers in this group yet.',
      action: q ? { label: 'Add as new customer', icon: 'person-add-outline' as const, onPress: () => setForm({ customer: null }) } : undefined,
    }
    : {
      icon: 'people-outline' as const, title: 'No customers yet',
      message: 'Customers are saved automatically when you add a phone number to a bill. They then earn loyalty points and you can see their order history here.',
      action: { label: 'Add customer', icon: 'person-add-outline' as const, onPress: () => setForm({ customer: null }) },
    };

  return (
    <Screen
      title="Customers"
      subtitle={subtitle}
      scroll={false}
      contentStyle={{ flex: 1, paddingBottom: 16 }}
      maxWidth={isDesktop ? 1680 : 1280}
      actions={<Button title={isPhone ? 'Add' : 'Add customer'} icon="person-add-outline" onPress={() => setForm({ customer: null })} />}
      toolbar={(
        <FilterBar onSearch={setQ} search={q} searchPlaceholder="Search name or phone" searching={pages.loading && !!q}
          filters={filters} value={tier} onChange={(k) => setTier(k as TierFilter)}
          right={(
            <ActionMenu items={sortMenu} title="Sort customers" align="end"
              trigger={(open) => <Button title={isPhone ? undefined : sortLabel} icon="swap-vertical-outline" variant="outline" onPress={open} accessibilityLabel={`Sort: ${sortLabel}`} />} />
          )} />
      )}
    >
      {offline ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 10, backgroundColor: colors.warningSoft, marginBottom: 8 }}>
          <Ionicons name="cloud-offline-outline" size={16} color={colors.warningText} />
          <Text variant="small" tone="warning" style={{ flex: 1 }}>Offline — showing customers saved on this device. Totals may be out of date.</Text>
          <Button title="Retry" size="sm" variant="ghost" onPress={() => void pages.reload()} />
        </View>
      ) : null}
      <View style={{ flex: 1, flexDirection: 'row', gap: 16, minHeight: 0 }}>
        <View style={[{ flex: 1, minWidth: 0, overflow: 'hidden' }, tableMode && { borderWidth: 1, borderRadius: 14, borderColor: colors.border, backgroundColor: colors.surface }]}
          onLayout={(e) => setListWidth(Math.round(e.nativeEvent.layout.width))}>
          <DataList<Customer>
            data={offline ? rows : pages.loaded ? rows : null}
            keyExtractor={(c) => c.id}
            columns={columns}
            renderCard={renderCard}
            layout={tableMode ? 'table' : 'cards'}
            cardHeight={76}
            loading={pages.loading}
            error={offline ? null : pages.error}
            onRetry={() => void pages.reload()}
            refreshing={pages.refreshing}
            onRefresh={() => void pages.reload()}
            onEndReached={offline ? undefined : pages.loadMore}
            loadingMore={pages.loadingMore}
            hasMore={pages.hasMore}
            onPressRow={setSelected}
            openKey={selected?.id ?? null}
            keyboard={!selected && !form}
            sort={sort}
            onSortChange={changeSort}
            empty={empty}
            testID="customer-list"
          />
        </View>
        {selected ? (
          <DetailPanel title={selected.name} subtitle={formatMobile(selected.phone)} onClose={() => setSelected(null)}
            headerRight={<Button title={isPhone ? undefined : 'Edit'} icon="create-outline" variant="ghost" size="sm" onPress={() => setForm({ customer: selected })} accessibilityLabel="Edit customer" />}>
            <CustomerDetail key={selected.id} customer={selected} compactHeader canEdit={false} onEdit={() => setForm({ customer: selected })} />
          </DetailPanel>
        ) : null}
      </View>

      {form ? (
        <CustomerFormSheet customer={form.customer} canEditPoints={manager} onClose={() => setForm(null)} onSaved={onSaved} />
      ) : null}
    </Screen>
  );
}
