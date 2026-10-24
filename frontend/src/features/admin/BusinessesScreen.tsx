/**
 * Every business on Tallyko (thousands): server-paged, virtualised list with search, access filters with server counts
 * (Locked / Demo / Development / Active / Ending in 7 days), status and plan menus.
 * Desktop: the business opens in a side panel and the list stays visible. Tablet/phone: its own page.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { errorMessage } from '@/api/client';
import { platformApi, type AccessFilter, type BusinessStatus, type BusinessSummary } from '@/api/platform';
import { ActionMenu, Button, DataList, FilterBar, Text, useHotkeys, type DataColumn } from '@/components/ui';
import { useApi } from '@/hooks/useApi';
import { ago } from '@/lib/format';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import { BusinessDetailView } from './BusinessDetailScreen';
import { OnboardBusinessSheet } from './OnboardBusinessSheet';
import { AccessBadge, BUSINESS_TYPE_LABEL, OfflineStrip, PlanBadge, STATUS_LABEL, StatusBadge, shortDate, useCanEdit } from './shared';

const PAGE = 50;

/** "8 h ago", "just now" */
function agoText(iso: string): string {
  const a = ago(iso);
  return /now/i.test(a) ? a : `${a} ago`;
}
type AccessKey = 'all' | AccessFilter;
const ACCESS_FILTERS: { key: AccessKey; label: string; icon?: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'all', label: 'All' },
  { key: 'locked', label: 'Locked', icon: 'lock-closed-outline' },
  { key: 'expiring', label: 'Ending in 7 days', icon: 'time-outline' },
  { key: 'trial', label: 'Demo', icon: 'hourglass-outline' },
  { key: 'active', label: 'Access on', icon: 'checkmark-circle-outline' },
  { key: 'development', label: 'Development', icon: 'construct-outline' },
];
const STATUSES: (BusinessStatus | 'all')[] = ['all', 'active', 'suspended', 'deleted'];

function isAccess(v: unknown): v is AccessFilter {
  return typeof v === 'string' && ACCESS_FILTERS.some((f) => f.key === v && v !== 'all');
}

export default function BusinessesScreen() {
  const { colors } = useTheme();
  const { isPhone, isDesktop } = useLayout();
  const canEdit = useCanEdit();
  const params = useLocalSearchParams<{ status?: string; plan?: string; q?: string; access?: string }>();
  const [query, setQuery] = useState(params.q ?? '');
  const [status, setStatus] = useState<BusinessStatus | 'all'>(STATUSES.includes(params.status as BusinessStatus) ? (params.status as BusinessStatus) : 'all');
  const [plan, setPlan] = useState<string>(params.plan ?? 'all');
  const [access, setAccess] = useState<AccessKey>(isAccess(params.access) ? params.access : 'all');
  const [items, setItems] = useState<BusinessSummary[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [counts, setCounts] = useState<Partial<Record<AccessKey, number>>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [onboarding, setOnboarding] = useState(false);
  const req = useRef(0);

  // Follow links like /admin/businesses?access=locked even when the screen is already mounted
  useEffect(() => { if (params.status && STATUSES.includes(params.status as BusinessStatus)) setStatus(params.status as BusinessStatus); }, [params.status]);
  useEffect(() => { if (isAccess(params.access)) setAccess(params.access); }, [params.access]);
  useEffect(() => { if (params.plan) setPlan(params.plan); }, [params.plan]);

  const plans = useApi(() => platformApi.plans(), []);
  const planName = useCallback((key: string) => plans.data?.plans.find((p) => p.key === key)?.name ?? key, [plans.data]);
  const base = useMemo(() => ({ q: query, status: status === 'all' ? null : status, plan: plan === 'all' ? null : plan }), [query, status, plan]);

  const load = useCallback(async (mode: 'first' | 'refresh' = 'first') => {
    const id = ++req.current;
    if (mode === 'first') setLoading(true); else setRefreshing(true);
    setError(null);
    try {
      // The access chips' counts come in the same call (same search / status / plan)
      const page = await platformApi.businesses({ ...base, access: access === 'all' ? null : access, limit: PAGE, offset: 0, withCounts: true });
      if (id !== req.current) return;
      setItems(page.items);
      setTotal(page.total);
      if (page.counts) setCounts(page.counts);
    } catch (e) {
      if (id === req.current) setError(errorMessage(e));
    } finally {
      if (id === req.current) { setLoading(false); setRefreshing(false); }
    }
  }, [base, access]);

  useEffect(() => { void load(); }, [load]);

  const loadMore = useCallback(async () => {
    if (loadingMore || total === null || items.length >= total) return;
    const id = req.current;
    setLoadingMore(true);
    try {
      const page = await platformApi.businesses({ ...base, access: access === 'all' ? null : access, limit: PAGE, offset: items.length });
      if (id !== req.current) return;
      setItems((list) => {
        const seen = new Set(list.map((b) => b.id));
        return [...list, ...page.items.filter((b) => !seen.has(b.id))];
      });
      setTotal(page.total);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, total, items.length, base, access]);

  const pickAccess = (key: string) => {
    const next = key as AccessKey;
    setAccess(next);
    router.setParams({ access: next === 'all' ? undefined : next });
  };
  const pickStatus = (s: BusinessStatus | 'all') => { setStatus(s); router.setParams({ status: s === 'all' ? undefined : s }); };
  const pickPlan = (p: string) => { setPlan(p); router.setParams({ plan: p === 'all' ? undefined : p }); };
  const filtered = !!query || status !== 'all' || plan !== 'all' || access !== 'all';
  const clearFilters = () => {
    setQuery(''); setStatus('all'); setPlan('all'); setAccess('all');
    router.setParams({ status: undefined, plan: undefined, q: undefined, access: undefined });
  };

  const open = useCallback((b: BusinessSummary) => {
    if (isDesktop) setOpenId(b.id);
    else router.push(`/admin/businesses/${b.id}` as Href);
  }, [isDesktop]);
  const panelOpen = isDesktop && !!openId;
  useHotkeys({ Escape: () => setOpenId(null) }, [], { enabled: panelOpen });

  const columns = useMemo<DataColumn<BusinessSummary>[]>(() => [
    { key: 'name', title: 'Business', flex: 2.6, render: (b) => (
      <View style={{ minWidth: 0 }}>
        <Text variant="bodyStrong" numberOfLines={1}>{b.name}</Text>
        <Text variant="small" tone="muted" numberOfLines={1}>{b.owner.name ? `${b.owner.name} · ` : ''}{b.owner.email ?? 'No owner'}</Text>
      </View>
    ) },
    { key: 'type', title: 'Type', flex: 1, hideBelow: 1100, value: (b) => BUSINESS_TYPE_LABEL[b.business_type] ?? b.business_type },
    { key: 'plan', title: 'Plan', flex: 1.1, hideBelow: 760, render: (b) => <PlanBadge name={planName(b.plan_key)} /> },
    { key: 'status', title: 'Status', width: 110, hideBelow: 640, render: (b) => <StatusBadge status={b.status} /> },
    { key: 'access', title: 'Access', flex: 1.5, render: (b) => (
      <View style={{ gap: 2 }}>
        <AccessBadge access={b.access} days />
        <Text variant="caption" tone="subtle" numberOfLines={1}>
          {b.access?.state === 'development' ? 'No expiry' : b.paid_until ? `${b.access?.state === 'lapsed' ? 'Ended' : 'Until'} ${shortDate(b.paid_until)}` : 'Never paid'}
        </Text>
      </View>
    ) },
    { key: 'last', title: 'Last bill', width: 110, hideBelow: 980, align: 'right', value: (b) => (b.last_activity_at ? agoText(b.last_activity_at) : '—') },
  ], [planName]);

  const renderCard = useCallback((b: BusinessSummary) => (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>{b.name}</Text>
        {b.status !== 'active' ? <StatusBadge status={b.status} /> : null}
      </View>
      <Text variant="small" tone="muted" numberOfLines={1}>{b.owner.email ?? 'No owner'} · {BUSINESS_TYPE_LABEL[b.business_type] ?? b.business_type} · {planName(b.plan_key)}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <AccessBadge access={b.access} days />
        <Text variant="caption" tone="subtle" numberOfLines={1} style={{ flexShrink: 1 }}>
          {b.last_activity_at ? `last bill ${agoText(b.last_activity_at)}` : 'no bills yet'}
        </Text>
      </View>
    </View>
  ), [planName]);

  const planItems = [{ key: 'all', name: 'Any plan' }, ...(plans.data?.plans ?? []).map((p) => ({ key: p.key, name: p.name }))];
  const menus = (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      <ActionMenu title="Status" align="end"
        items={STATUSES.map((s) => ({ key: s, label: s === 'all' ? 'Any status' : STATUS_LABEL[s], selected: status === s, onPress: () => pickStatus(s) }))}
        trigger={(openMenu) => <Button title={isPhone ? undefined : status === 'all' ? 'Status' : STATUS_LABEL[status]} accessibilityLabel="Filter by status" icon="funnel-outline" iconRight={isPhone ? undefined : 'chevron-down'}
          variant={status === 'all' ? 'outline' : 'tonal'} size="sm" onPress={openMenu} />} />
      <ActionMenu title="Plan" align="end"
        items={planItems.map((p) => ({ key: p.key, label: p.name, selected: plan === p.key, onPress: () => pickPlan(p.key) }))}
        trigger={(openMenu) => <Button title={isPhone ? undefined : plan === 'all' ? 'Plan' : planName(plan)} accessibilityLabel="Filter by plan" icon="pricetag-outline" iconRight={isPhone ? undefined : 'chevron-down'}
          variant={plan === 'all' ? 'outline' : 'tonal'} size="sm" onPress={openMenu} />} />
    </View>
  );

  const pad = isPhone ? 12 : 24;
  const list = (
    <View style={{ flex: 1, minWidth: 0, paddingHorizontal: pad, paddingTop: isPhone ? 12 : 20, gap: 12 }}>
      <View style={styles.titleRow}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant={isPhone ? 'h1' : 'display'} accessibilityRole="header" numberOfLines={1}>Businesses</Text>
          <Text tone="muted" numberOfLines={1}>
            {total === null ? 'Every shop, restaurant and kitchen using Tallyko.' : `${total.toLocaleString('en-IN')} ${filtered ? 'matching' : 'on Tallyko'}`}
          </Text>
        </View>
        {canEdit ? <Button title={isPhone ? 'Onboard' : 'Onboard business'} icon="add" onPress={() => setOnboarding(true)} /> : null}
      </View>
      <FilterBar
        search={params.q ?? ''}
        onSearch={(v) => { setQuery(v); router.setParams({ q: v || undefined }); }}
        searchPlaceholder="Business name or owner email"
        filters={ACCESS_FILTERS.map((f) => ({ key: f.key, label: f.label, icon: f.icon, count: counts[f.key] }))}
        value={access}
        onChange={pickAccess}
        searching={loading && items.length > 0}
        right={menus}
      />
      <View style={[styles.listBox, { borderColor: colors.border, backgroundColor: colors.surface }]}>
        <DataList
          data={items}
          keyExtractor={(b) => b.id}
          columns={columns}
          renderCard={renderCard}
          cardHeight={92}
          rowHeight={58}
          tableMinWidth={560}
          loading={loading}
          error={error}
          onRetry={() => void load()}
          refreshing={refreshing}
          onRefresh={() => void load('refresh')}
          onEndReached={() => void loadMore()}
          loadingMore={loadingMore}
          hasMore={total !== null && items.length < total}
          onPressRow={open}
          keyboard={!panelOpen}
          openKey={panelOpen ? openId : null}
          rowActions={() => <Ionicons name="chevron-forward" size={18} color={colors.textSubtle} />}
          rowActionsWidth={32}
          empty={filtered
            ? { icon: 'search-outline', title: 'No businesses match', message: 'Try another name or email, or clear the filters.', action: { label: 'Clear filters', onPress: clearFilters, icon: 'close-circle-outline' } }
            : { icon: 'storefront-outline', title: 'No businesses yet', message: 'Businesses appear here when they sign up or when you onboard them.' }}
        />
      </View>
      {total !== null && items.length > 0 ? (
        <Text variant="caption" tone="subtle" style={{ paddingBottom: 8 }}>
          {`Showing ${items.length.toLocaleString('en-IN')} of ${total.toLocaleString('en-IN')}${items.length < total ? ' · scroll for more' : ''}`}
        </Text>
      ) : null}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <OfflineStrip />
      <View style={{ flex: 1, flexDirection: 'row', minHeight: 0 }}>
        {list}
        {panelOpen ? (
          <View style={[styles.panel, { borderLeftColor: colors.border, backgroundColor: colors.background }]}>
            <BusinessDetailView key={openId!} businessId={openId!} onClose={() => setOpenId(null)} onChanged={() => void load('refresh')} />
          </View>
        ) : null}
      </View>
      {onboarding ? (
        <OnboardBusinessSheet plans={plans.data?.plans ?? []} onClose={() => setOnboarding(false)} onDone={() => void load('refresh')} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  listBox: { flex: 1, minHeight: 0, borderWidth: 1, borderRadius: 12, overflow: 'hidden' },
  panel: { width: '46%', maxWidth: 640, minWidth: 460, borderLeftWidth: 1 },
});
