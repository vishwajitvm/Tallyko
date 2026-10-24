/** Activity log tab: who cancelled, discounted, changed staff/roles/settings, with filters and paging. */
import React, { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { errorMessage } from '@/api/client';
import { teamApi, type AuditEntry, type StaffAccount } from '@/api/access';
import { Badge, Button, Card, Chip, EmptyState, ErrorState, Input, Loading, Segmented, Sheet, Text, toast, type BadgeTone } from '@/components/ui';
import { useApi } from '@/hooks/useApi';
import { ago, formatTime } from '@/lib/format';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import { Avatar, ChipScroller, Row, utcRange, type RangeKey, type StaffCtx } from './shared';

type IconName = keyof typeof Ionicons.glyphMap;
type Period = RangeKey | 'all';

const PAGE = 50;

const CATEGORIES: { value: string; label: string; icon: IconName }[] = [
  { value: '', label: 'Everything', icon: 'list-outline' },
  { value: 'order', label: 'Bills', icon: 'receipt-outline' },
  { value: 'staff', label: 'Staff', icon: 'people-outline' },
  { value: 'role', label: 'Roles', icon: 'shield-half-outline' },
  { value: 'settings', label: 'Settings', icon: 'settings-outline' },
  { value: 'modules', label: 'Modules', icon: 'apps-outline' },
  { value: 'tax', label: 'GST', icon: 'calculator-outline' },
  { value: 'offer', label: 'Offers', icon: 'pricetag-outline' },
  { value: 'inventory', label: 'Stock', icon: 'cube-outline' },
  { value: 'customer', label: 'Customers', icon: 'heart-outline' },
];

const PERIODS: { value: Period; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: 'all', label: 'All' },
];

function categoryOf(action: string) {
  const prefix = action.split('.')[0] ?? '';
  return CATEGORIES.find((c) => c.value === prefix) ?? { value: prefix, label: prefix, icon: 'ellipse-outline' as IconName };
}

function toneOf(action: string): BadgeTone {
  if (/cancel|void|delete/.test(action)) return 'danger';
  if (/discount|points|adjust/.test(action)) return 'warning';
  if (/create/.test(action)) return 'success';
  return 'neutral';
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

function detailLines(e: AuditEntry): string[] {
  const d = e.details;
  if (!d || typeof d !== 'object') return [];
  const out: string[] = [];
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
  const added = list(d.added);
  const removed = list(d.removed);
  if (added.length) out.push(`Added: ${added.join(', ')}`);
  if (removed.length) out.push(`Removed: ${removed.join(', ')}`);
  for (const [k, v] of Object.entries(d)) {
    if (k === 'added' || k === 'removed' || v === null || v === undefined || typeof v === 'object') continue;
    out.push(`${k.replace(/_/g, ' ')}: ${String(v)}`);
  }
  return out;
}

export function ActivityTab({ ctx, refreshKey }: { ctx: StaffCtx; refreshKey: number }) {
  if (!ctx.hasFeature('audit_log')) {
    return (
      <Card>
        <EmptyState icon="lock-closed-outline" title="Activity log isn't in your plan"
          message="See who cancelled bills, gave discounts or changed staff and settings. Contact Tallyko to upgrade your plan." />
      </Card>
    );
  }
  return <Activity ctx={ctx} refreshKey={refreshKey} />;
}

function Activity({ ctx, refreshKey }: { ctx: StaffCtx; refreshKey: number }) {
  const { isPhone } = useLayout();
  const { colors } = useTheme();
  const [period, setPeriod] = useState<Period>('7d');
  const [category, setCategory] = useState('');
  const [staffId, setStaffId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [more, setMore] = useState<AuditEntry[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);

  const canSeeStaff = ctx.can('staff.view') && ctx.hasFeature('staff');
  const staffQ = useApi(() => (canSeeStaff ? teamApi.staff() : Promise.resolve([] as StaffAccount[])), [canSeeStaff]);

  const query = () => {
    const r = period === 'all' ? null : utcRange(period);
    return { action: category || undefined, staff_id: staffId ?? undefined, date_from: r?.from, date_to: r?.to, limit: PAGE };
  };
  const q = useApi(() => teamApi.audit(query()), [period, category, staffId, refreshKey]);
  useEffect(() => setMore([]), [period, category, staffId, refreshKey]);

  const items = useMemo(() => {
    const seen = new Set<string>();
    return [...(q.data?.items ?? []), ...more].filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)));
  }, [q.data, more]);
  const total = q.data?.total ?? 0;
  const groups = useMemo(() => {
    const out: { day: string; items: AuditEntry[] }[] = [];
    for (const e of items) {
      const day = dayLabel(e.created_at);
      const last = out[out.length - 1];
      if (last && last.day === day) last.items.push(e);
      else out.push({ day, items: [e] });
    }
    return out;
  }, [items]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const page = await teamApi.audit({ ...query(), offset: items.length });
      setMore((m) => [...m, ...page.items]);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setLoadingMore(false);
    }
  };

  const selectedStaff = staffQ.data?.find((s) => s.id === staffId);
  const filtered = !!category || !!staffId;

  return (
    <View style={{ gap: 14 }}>
      <View style={{ flexDirection: isPhone ? 'column' : 'row', gap: 12, alignItems: isPhone ? 'stretch' : 'center', justifyContent: 'space-between' }}>
        <View style={{ minWidth: isPhone ? undefined : 340 }}>
          <Segmented size="sm" value={period} options={PERIODS} onChange={setPeriod} />
        </View>
        {canSeeStaff ? (
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <Button title={selectedStaff ? selectedStaff.full_name || selectedStaff.email : 'Everyone'} icon="person-outline" iconRight="chevron-down"
              variant="secondary" size="sm" onPress={() => setPicking(true)} accessibilityLabel="Filter by staff member" />
            {staffId ? <Button icon="close" size="sm" variant="ghost" onPress={() => setStaffId(null)} accessibilityLabel="Show everyone" /> : null}
          </View>
        ) : null}
      </View>
      <ChipScroller>
        {CATEGORIES.map((c) => (
          <Chip key={c.value || 'all'} label={c.label} icon={c.icon} selected={category === c.value} onPress={() => setCategory(c.value)} />
        ))}
      </ChipScroller>

      {q.loading && !q.data ? <Loading label="Loading activity" /> : null}
      {q.error && !q.data ? <ErrorState message={q.error} onRetry={q.reload} /> : null}

      {q.data ? (
        items.length === 0 ? (
          <Card>
            <EmptyState icon="time-outline" title="Nothing recorded"
              message={filtered ? 'No activity matches these filters. Try another filter or a longer period.' : 'Cancelled bills, discounts, voided items and changes to staff, roles and settings show up here.'}
              action={filtered ? { label: 'Clear filters', icon: 'close', onPress: () => { setCategory(''); setStaffId(null); } } : undefined} />
          </Card>
        ) : (
          <>
            <Text variant="small" tone="muted">Showing {items.length} of {total}</Text>
            {groups.map((g) => (
              <View key={g.day} style={{ gap: 8 }}>
                <Text variant="caption" tone="subtle" style={{ textTransform: 'uppercase' }}>{g.day}</Text>
                <Card padded={false} style={{ overflow: 'hidden' }}>
                  {g.items.map((e, i) => {
                    const cat = categoryOf(e.action);
                    const tone = toneOf(e.action);
                    const details = detailLines(e);
                    return (
                      <Row key={e.id} first={i === 0} style={{ alignItems: 'flex-start' }}>
                        {!isPhone ? (
                          <View style={{ width: 64, paddingTop: 2 }}>
                            <Text variant="smallStrong">{formatTime(e.created_at)}</Text>
                            <Text variant="caption" tone="subtle">{ago(e.created_at)}</Text>
                          </View>
                        ) : null}
                        <View style={{ width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
                          backgroundColor: tone === 'danger' ? colors.dangerSoft : tone === 'warning' ? colors.warningSoft : colors.surfaceSunken }}>
                          <Ionicons name={cat.icon} size={18} color={tone === 'danger' ? colors.danger : tone === 'warning' ? colors.warning : colors.textMuted} />
                        </View>
                        <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <Text variant="bodyStrong">{e.label}</Text>
                            {tone === 'danger' ? <Badge label={cat.label} tone="danger" /> : null}
                          </View>
                          {e.summary ? <Text variant="small" numberOfLines={3}>{e.summary}</Text> : null}
                          {details.map((line) => <Text key={line} variant="small" tone="muted" numberOfLines={3}>{line}</Text>)}
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <Ionicons name="person-circle-outline" size={14} color={colors.textSubtle} />
                            <Text variant="small" tone="muted">{e.actor_name || 'System'}</Text>
                            {isPhone ? <Text variant="small" tone="subtle">· {formatTime(e.created_at)}</Text> : null}
                          </View>
                        </View>
                      </Row>
                    );
                  })}
                </Card>
              </View>
            ))}
            {items.length < total ? (
              <Button title={`Load ${Math.min(PAGE, total - items.length)} more`} variant="secondary" icon="chevron-down" onPress={loadMore} loading={loadingMore}
                style={{ alignSelf: 'center' }} />
            ) : null}
          </>
        )
      ) : null}

      {picking ? (
        <StaffPicker staff={staffQ.data ?? []} loading={staffQ.loading && !staffQ.data} error={staffQ.error} value={staffId}
          onPick={(id) => { setStaffId(id); setPicking(false); }} onClose={() => setPicking(false)} />
      ) : null}
    </View>
  );
}

function StaffPicker({ staff, loading, error, value, onPick, onClose }: {
  staff: StaffAccount[]; loading: boolean; error: string | null; value: string | null; onPick: (id: string | null) => void; onClose: () => void;
}) {
  const { colors } = useTheme();
  const [search, setSearch] = useState('');
  const s = search.trim().toLowerCase();
  const list = staff.filter((m) => !s || (m.full_name ?? '').toLowerCase().includes(s) || m.email.toLowerCase().includes(s));
  const option = (id: string | null, title: string, subtitle?: string, inactive?: boolean) => {
    const selected = value === id;
    return (
      <Pressable key={id ?? 'all'} onPress={() => onPick(id)} accessibilityRole="radio" accessibilityState={{ checked: selected }}
        style={({ hovered }: any) => [
          { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 10, minHeight: 52, borderRadius: 10 },
          { backgroundColor: selected ? colors.primarySoft : hovered ? colors.surfaceSunken : 'transparent' },
          Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : null,
        ]}>
        {id ? <Avatar name={title} size={32} active={!inactive} /> : <Ionicons name="people-outline" size={22} color={colors.textMuted} style={{ width: 32, textAlign: 'center' }} />}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="bodyStrong" numberOfLines={1} color={selected ? colors.primarySoftText : undefined}>{title}</Text>
          {subtitle ? <Text variant="small" tone="muted" numberOfLines={1}>{subtitle}</Text> : null}
        </View>
        {selected ? <Ionicons name="checkmark" size={18} color={colors.primary} /> : null}
      </Pressable>
    );
  };
  return (
    <Sheet visible onClose={onClose} title="Filter by staff" width={460}>
      {staff.length > 8 ? <Input value={search} onChangeText={setSearch} placeholder="Search staff" icon="search-outline" autoCapitalize="none" autoCorrect={false} /> : null}
      {loading ? <Loading /> : null}
      {error && !staff.length ? <Text tone="danger">{error}</Text> : null}
      <View style={{ gap: 2 }}>
        {!s ? option(null, 'Everyone') : null}
        {list.map((m) => option(m.id, m.full_name || m.email, `${m.role_name}${m.is_active ? '' : ' · deactivated'}`, !m.is_active))}
      </View>
    </Sheet>
  );
}
