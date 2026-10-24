/**
 * Owner requests: businesses can't delete their own records, so owners ask Tallyko to archive or permanently delete bills
 * (or ask something else). Review the bills, then archive, delete or decline with a response the owner sees.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { errorMessage } from '@/api/client';
import { platformApi, type AdminBill, type OwnerRequest, type OwnerRequestKind, type OwnerRequestStatus } from '@/api/platform';
import { ActionMenu, Badge, Button, Card, DataList, FilterBar, Input, Loading, Segmented, Sheet, Text, toast, type BadgeTone, type DataColumn } from '@/components/ui';
import { useApi } from '@/hooks/useApi';
import { usePagedList } from '@/hooks/usePagedList';
import { ago, formatDateTime } from '@/lib/format';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import { Callout } from '@/features/settings/components';
import { BillRow, DeleteConfirm, billsSummary } from './BusinessRecords';
import { AdminListFrame, ReadOnlyNote, goTo, plural, setPendingOwnerRequests, useCanEdit, useOnline } from './shared';

type Filter = OwnerRequestStatus | 'all';
const PAGE = 50;
type Resolution = 'archive' | 'delete' | 'none';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'pending', label: 'Pending' }, { value: 'done', label: 'Done' }, { value: 'rejected', label: 'Declined' }, { value: 'all', label: 'All' },
];
const KIND_LABEL: Record<OwnerRequestKind, string> = { archive_bills: 'Archive bills', delete_bills: 'Delete bills', other: 'Other request' };
const KIND_TONE: Record<OwnerRequestKind, BadgeTone> = { archive_bills: 'warning', delete_bills: 'danger', other: 'info' };
const STATUS_LABEL: Record<OwnerRequestStatus, string> = { pending: 'Waiting', done: 'Done', rejected: 'Declined' };
const STATUS_TONE: Record<OwnerRequestStatus, BadgeTone> = { pending: 'warning', done: 'success', rejected: 'neutral' };
const TAKEN_LABEL: Record<string, string> = { archived: 'Bills archived', deleted: 'Bills permanently deleted', none: 'No change made' };

/** Bills an owner request names, fetched by id (GET /platform/businesses/{id}/orders?ids=…), once per request per screen load. */
type BillsCache = Map<string, Promise<AdminBill[]>>;

function billsFor(cache: BillsCache, r: OwnerRequest): Promise<AdminBill[]> {
  let promise = cache.get(r.id);
  if (!promise) {
    promise = r.order_ids.length
      ? platformApi.businessBills(r.business_id, { include_archived: true, ids: r.order_ids, limit: Math.min(500, r.order_ids.length) })
      : Promise.resolve([]);
    cache.set(r.id, promise);
    promise.catch(() => cache.delete(r.id));
  }
  return promise;
}

function useRequestedBills(cache: BillsCache, request: OwnerRequest, enabled: boolean) {
  const [state, setState] = useState<{ loading: boolean; bills: AdminBill[] | null; error: string | null }>({ loading: false, bills: null, error: null });
  useEffect(() => {
    if (!enabled || !request.order_ids.length) return undefined;
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    billsFor(cache, request)
      .then((bills) => { if (!cancelled) setState({ loading: false, bills, error: null }); })
      .catch((e) => { if (!cancelled) setState({ loading: false, bills: null, error: errorMessage(e) }); });
    return () => { cancelled = true; };
  }, [cache, request, enabled]);
  return state;
}

export default function OwnerRequestsScreen() {
  const { isPhone } = useLayout();
  const canEdit = useCanEdit();
  const online = useOnline();
  const params = useLocalSearchParams<{ status?: string }>();
  const initial = FILTERS.some((f) => f.value === params.status) ? (params.status as Filter) : 'pending';
  const [filter, setFilter] = useState<Filter>(initial);
  const [query, setQuery] = useState('');
  const [viewing, setViewing] = useState<OwnerRequest | null>(null);
  const [resolving, setResolving] = useState<{ request: OwnerRequest; bills: AdminBill[]; action: Resolution } | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const cache = useRef<BillsCache>(new Map());
  // Server search + paging; the Pending chip's count is the only one we fetch (done / declined grow forever)
  const list = usePagedList<OwnerRequest>(
    async (offset, limit) => { const r = await platformApi.ownerRequestsPage(filter, { q: query, offset, limit }); return { items: r.items, total: r.total }; },
    `${filter}|${query.trim()}`, { pageSize: PAGE, idOf: (r) => r.id },
  );
  // Counts per status for the chips and the sidebar badge (one tiny request; totals come from the server)
  const pending = useApi(() => platformApi.ownerRequestsPage('all', { limit: 1 }), []);
  const statusCounts = pending.data?.counts;

  useEffect(() => {
    if (params.status && FILTERS.some((f) => f.value === params.status)) setFilter(params.status as Filter);
  }, [params.status]);

  useEffect(() => {
    if (statusCounts) setPendingOwnerRequests(statusCounts.pending ?? 0);
  }, [statusCounts]);

  const q = query.trim();
  const items = list.items;


  const changeFilter = (f: string) => {
    setFilter(f as Filter);
    router.setParams({ status: f === 'pending' ? undefined : f });
  };

  /** Load the request's bills, then open the confirm step (archive / delete / decline always confirm with a reply). */
  const resolve = useCallback(async (r: OwnerRequest, action: Resolution) => {
    setOpeningId(r.id);
    try {
      const bills = await billsFor(cache.current, r);
      setViewing(null);
      setResolving({ request: r, bills, action });
    } catch (e) {
      toast.error(`Couldn't load the bills: ${errorMessage(e)}`);
    } finally {
      setOpeningId(null);
    }
  }, []);

  const actions = useCallback((r: OwnerRequest) => {
    if (r.status !== 'pending' || !canEdit) {
      return <Text variant="caption" tone="subtle" numberOfLines={1}>{r.handled_by ?? ''}</Text>;
    }
    const hasBills = r.order_ids.length > 0;
    const primary: Resolution = !hasBills ? 'none' : r.kind === 'delete_bills' ? 'delete' : 'archive';
    const label = primary === 'archive' ? 'Archive' : primary === 'delete' ? 'Delete…' : 'Reply';
    return (
      <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
        <Button title={isPhone ? undefined : label} accessibilityLabel={`${label} ${r.business_name}`} size="sm"
          icon={primary === 'archive' ? 'archive-outline' : primary === 'delete' ? 'trash-outline' : 'send-outline'}
          variant={primary === 'delete' ? 'dangerOutline' : 'tonal'} loading={openingId === r.id}
          onPress={() => void resolve(r, primary)} disabled={!online} disabledReason="You're offline" />
        <ActionMenu align="end" title={r.business_name}
          items={[
            { key: 'view', label: 'Open request', icon: 'eye-outline', onPress: () => setViewing(r) },
            { key: 'biz', label: 'Open business', icon: 'storefront-outline', onPress: () => goTo(`/admin/businesses/${r.business_id}`) },
            ...(hasBills ? [
              { key: 'archive', label: 'Archive bills', icon: 'archive-outline' as const, group: 'act', hidden: primary === 'archive', disabled: !online, onPress: () => void resolve(r, 'archive') },
              { key: 'delete', label: 'Delete permanently…', icon: 'trash-outline' as const, group: 'act', danger: true, hidden: primary === 'delete', disabled: !online, onPress: () => void resolve(r, 'delete') },
            ] : []),
            { key: 'none', label: hasBills ? 'Decline…' : 'Reply & close…', icon: 'close-circle-outline', group: 'act', hidden: primary === 'none', disabled: !online, onPress: () => void resolve(r, 'none') },
          ]} />
      </View>
    );
  }, [canEdit, online, openingId, isPhone, resolve]);

  const columns = useMemo<DataColumn<OwnerRequest>[]>(() => [
    { key: 'business', title: 'Request', flex: 3, render: (r) => (
      <View style={{ minWidth: 0 }}>
        <Text variant="bodyStrong" numberOfLines={1}>{r.business_name}</Text>
        <Text variant="small" tone="muted" numberOfLines={1}>{r.message}</Text>
      </View>
    ) },
    { key: 'kind', title: 'Asks to', width: 150, render: (r) => <Badge label={KIND_LABEL[r.kind] ?? r.kind} tone={KIND_TONE[r.kind] ?? 'neutral'}
      icon={r.kind === 'delete_bills' ? 'trash-outline' : r.kind === 'archive_bills' ? 'archive-outline' : 'chatbubble-outline'} /> },
    { key: 'bills', title: 'Bills', width: 70, numeric: true, hideBelow: 760, value: (r) => (r.order_ids.length ? r.order_ids.length : '—') },
    { key: 'sent', title: 'Sent', width: 100, hideBelow: 880, value: (r) => `${ago(r.created_at)} ago` },
    { key: 'status', title: 'Status', width: 110, hideBelow: 1040, render: (r) => <Badge label={STATUS_LABEL[r.status] ?? r.status} tone={STATUS_TONE[r.status] ?? 'neutral'} /> },
  ], []);

  const renderCard = useCallback((r: OwnerRequest) => (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>{r.business_name}</Text>
        <Text variant="caption" tone="subtle">{ago(r.created_at)} ago</Text>
      </View>
      <Text variant="small" tone="muted" numberOfLines={1}>{r.message}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Badge label={`${KIND_LABEL[r.kind] ?? r.kind}${r.order_ids.length ? ` · ${r.order_ids.length}` : ''}`} tone={KIND_TONE[r.kind] ?? 'neutral'} />
        <View style={{ flex: 1 }} />
        {actions(r)}
      </View>
    </View>
  ), [actions]);

  return (
    <AdminListFrame
      title="Owner requests"
      subtitle="Businesses can't delete their own records. Owners ask here to archive or delete bills; your reply is shown to them."
      toolbar={
        <View style={{ gap: 8 }}>
          <FilterBar onSearch={setQuery} searchPlaceholder="Business, message or email"
            filters={FILTERS.map((f) => ({ key: f.value, label: f.label, count: statusCounts ? (statusCounts[f.value] ?? 0) : undefined }))}
            value={filter} onChange={changeFilter} />
          {!canEdit ? <ReadOnlyNote what="archive or delete records" /> : null}
        </View>
      }
    >
      <DataList
        data={items}
        keyExtractor={(r) => r.id}
        columns={columns}
        renderCard={renderCard}
        rowHeight={60}
        cardHeight={112}
        tableMinWidth={620}
        loading={list.loading}
        error={list.error}
        onRetry={list.reload}
        refreshing={list.refreshing}
        onRefresh={() => { cache.current = new Map(); void list.reload(); void pending.reload(); }}
        onEndReached={list.loadMore}
        loadingMore={list.loadingMore}
        hasMore={list.hasMore}
        openKey={viewing?.id ?? null}
        onPressRow={(r) => setViewing(r)}
        keyboard={!viewing && !resolving}
        rowActions={actions}
        rowActionsWidth={isPhone ? 100 : 170}
        extraData={openingId}
        empty={filter === 'pending' && !q
          ? { icon: 'checkmark-done-outline', title: 'All caught up', message: 'No owner is waiting. Requests appear here when an owner asks Tallyko to archive or delete bills.' }
          : { icon: 'mail-outline', title: 'Nothing here', message: q ? 'No request matches that search.' : 'No requests with this status yet.' }}
      />

      {viewing ? (
        <Sheet visible onClose={() => setViewing(null)} title={viewing.business_name} subtitle={KIND_LABEL[viewing.kind] ?? 'Request'} width={820}>
          <RequestCard request={viewing} cache={cache.current} canEdit={canEdit}
            onResolve={(action, bills) => { setViewing(null); setResolving({ request: viewing, bills, action }); }} />
        </Sheet>
      ) : null}
      {resolving ? (
        <ResolveSheet request={resolving.request} bills={resolving.bills} initial={resolving.action} onClose={() => setResolving(null)}
          onDone={() => {
            if (filter === 'pending') list.setItems((rows) => rows.filter((x) => x.id !== resolving.request.id));
            setResolving(null);
            cache.current = new Map();
            void list.refreshSilently();
            void pending.reload();
          }} />
      ) : null}
    </AdminListFrame>
  );
}

function RequestCard({ request: r, cache, canEdit, onResolve }: {
  request: OwnerRequest; cache: BillsCache; canEdit: boolean; onResolve: (action: Resolution, bills: AdminBill[]) => void;
}) {
  const { colors, radius } = useTheme();
  const { isPhone } = useLayout();
  const online = useOnline();
  const pending = r.status === 'pending';
  const [showBills, setShowBills] = useState(pending);
  const bills = useRequestedBills(cache, r, showBills);
  const found = bills.bills ?? [];
  const missing = bills.bills ? r.order_ids.length - found.length : 0;
  const ready = !r.order_ids.length || !!bills.bills;

  return (
    <Card style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Pressable onPress={() => goTo(`/admin/businesses/${r.business_id}`)} accessibilityRole="link" accessibilityLabel={`Open ${r.business_name}`}
          style={({ hovered }: any) => [{ flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 }, hovered && { opacity: 0.75 },
            Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}>
          <Text variant="h3" numberOfLines={1} style={{ flexShrink: 1 }}>{r.business_name}</Text>
          <Ionicons name="open-outline" size={16} color={colors.textSubtle} />
        </Pressable>
        <Badge label={KIND_LABEL[r.kind] ?? r.kind} tone={KIND_TONE[r.kind] ?? 'neutral'} icon={r.kind === 'delete_bills' ? 'trash-outline' : r.kind === 'archive_bills' ? 'archive-outline' : 'chatbubble-outline'} />
        <Badge label={STATUS_LABEL[r.status] ?? r.status} tone={STATUS_TONE[r.status] ?? 'neutral'} />
        <Text variant="small" tone="subtle">{ago(r.created_at)} ago{r.requested_by ? ` · ${r.requested_by}` : ''}</Text>
      </View>

      <View style={{ padding: 12, borderRadius: radius.md, backgroundColor: colors.surfaceSunken, flexDirection: 'row', gap: 8 }}>
        <Ionicons name="chatbubble-ellipses-outline" size={16} color={colors.textMuted} style={{ marginTop: 2 }} />
        <Text style={{ flex: 1 }} selectable>{r.message}</Text>
      </View>

      {r.order_ids.length ? (
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text variant="smallStrong" tone="muted" style={{ flex: 1 }}>
              {bills.bills ? billsSummary(found) : `${plural(r.order_ids.length, 'bill')} in this request`}
            </Text>
            {!pending ? <Button title={showBills ? 'Hide bills' : 'Show bills'} size="sm" variant="ghost" onPress={() => setShowBills((v) => !v)} /> : null}
          </View>
          {showBills && bills.loading ? <Loading /> : null}
          {showBills && bills.error ? <Text variant="small" tone="danger">Couldn't load the bills: {bills.error}</Text> : null}
          {showBills && found.length ? (
            <Card padded={false} style={{ overflow: 'hidden' }}>
              {found.map((b, i) => <BillRow key={b.id} bill={b} first={i === 0} />)}
            </Card>
          ) : null}
          {showBills && missing > 0 ? (
            <Text variant="small" tone="subtle">
              {`${plural(missing, 'bill')} not found: already deleted.`}
            </Text>
          ) : null}
        </View>
      ) : null}

      {!pending ? (
        <Callout tone={r.status === 'done' ? 'success' : 'neutral'} title={TAKEN_LABEL[r.action_taken ?? 'none'] ?? 'Handled'}>
          {`${r.response ? `“${r.response}”` : 'No response.'}${r.handled_by ? ` · ${r.handled_by}` : ''}${r.handled_at ? ` · ${formatDateTime(r.handled_at)}` : ''}`}
        </Callout>
      ) : null}

      {pending && canEdit ? (
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          {r.order_ids.length ? (
            <>
              <Button title="Archive bills" icon="archive-outline" size="sm" variant={r.kind === 'delete_bills' ? 'secondary' : 'primary'}
                onPress={() => onResolve('archive', found)} disabled={!online || !ready} />
              <Button title={isPhone ? 'Delete' : 'Delete permanently'} icon="trash-outline" size="sm" variant="danger"
                onPress={() => onResolve('delete', found)} disabled={!online || !ready} />
            </>
          ) : null}
          <Button title={r.order_ids.length ? 'Decline' : 'Reply & close'} icon={r.order_ids.length ? 'close' : 'send-outline'} size="sm" variant="secondary"
            onPress={() => onResolve('none', found)} disabled={!online} />
        </View>
      ) : null}
    </Card>
  );
}

const RESPONSES: Record<Resolution, string[]> = {
  archive: ['Archived: the bills no longer show in your lists or reports.', 'Archived the training bills as asked.'],
  delete: ['Permanently deleted as you asked.', 'Deleted the test bills; stock and loyalty were reversed.'],
  none: ['These are tax invoices and must stay on record for GST, so we can’t remove them.', 'Please tell us which bills you mean (bill numbers).'],
};

function ResolveSheet({ request: r, bills, initial, onClose, onDone }: {
  request: OwnerRequest; bills: AdminBill[]; initial: Resolution; onClose: () => void; onDone: () => void;
}) {
  const online = useOnline();
  const [action, setAction] = useState<Resolution>(initial);
  const [response, setResponse] = useState('');
  const [typed, setTyped] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const hasBills = r.order_ids.length > 0;
  const options: { value: Resolution; label: string }[] = hasBills
    ? [{ value: 'archive', label: 'Archive' }, { value: 'delete', label: 'Delete' }, { value: 'none', label: 'Decline' }]
    : [{ value: 'none', label: 'Reply & close' }];
  const errors = {
    response: response.trim().length < 2 ? 'Write a short response; the owner sees it.' : undefined,
    typed: action === 'delete' && typed !== 'DELETE' ? 'Type DELETE in capitals.' : undefined,
  };

  const submit = async () => {
    setSubmitted(true);
    setFormError(null);
    if (errors.response || errors.typed) return;
    setSaving(true);
    try {
      const res = await platformApi.resolveOwnerRequest(r.id, {
        action, response: response.trim(), ...(action === 'delete' ? { confirm: 'DELETE' as const } : {}),
      });
      toast.success(action === 'archive' ? 'Bills archived · owner notified' : action === 'delete' ? 'Bills deleted · owner notified' : 'Reply sent to the owner');
      if (res.warning) toast.warning(res.warning);
      onDone();
    } catch (e) {
      setFormError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const title = action === 'archive' ? 'Archive requested bills' : action === 'delete' ? 'Delete requested bills permanently' : hasBills ? 'Decline request' : 'Reply to owner';
  return (
    <Sheet visible onClose={onClose} title={title} subtitle={`${r.business_name}${hasBills ? ` · ${billsSummary(bills)}` : ''}`} width={640}
      footer={
        <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'flex-end' }}>
          <Button title="Cancel" variant="secondary" onPress={onClose} disabled={saving} />
          <Button title={action === 'archive' ? 'Archive & reply' : action === 'delete' ? 'Delete & reply' : 'Send reply'}
            icon={action === 'archive' ? 'archive-outline' : action === 'delete' ? 'trash-outline' : 'send-outline'}
            variant={action === 'delete' ? 'danger' : 'primary'} onPress={submit} loading={saving}
            disabled={!online || (action === 'delete' && typed !== 'DELETE')} />
        </View>
      }>
      {formError ? <Callout tone="danger">{formError}</Callout> : null}
      {options.length > 1 ? (
        <View style={{ maxWidth: 420 }}>
          <Segmented value={action} options={options} onChange={(a) => { setAction(a); setTyped(''); }} />
        </View>
      ) : null}
      {hasBills && bills.length < r.order_ids.length ? (
        <Callout tone="warning">
          {`${plural(r.order_ids.length - bills.length, 'requested bill')} couldn't be found. If a bill was already deleted, ${action === 'none' ? 'declining still works' : 'the action fails: decline and explain instead'}.`}
        </Callout>
      ) : null}
      {action === 'archive' ? (
        <Callout tone="info" icon="archive-outline">Archived bills leave the owner's lists and reports but stay on record (GST-safe) and can be restored from the business page.</Callout>
      ) : null}
      {action === 'delete' ? (
        <DeleteConfirm bills={bills} typed={typed} onTyped={setTyped} error={submitted ? errors.typed : undefined}
          onArchiveInstead={() => { setAction('archive'); setTyped(''); }} />
      ) : null}
      {action === 'none' && hasBills ? <Callout tone="neutral">Nothing changes. The request is closed as declined and the owner sees your response.</Callout> : null}
      <Input label="Response to the owner" required value={response} onChangeText={setResponse} maxLength={500} multiline
        error={submitted ? errors.response : undefined} style={{ minHeight: 72, textAlignVertical: 'top', paddingTop: 10 }}
        placeholder="Shown to the owner in the app" />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {RESPONSES[action].map((t) => <Button key={t} title={t} size="sm" variant={response === t ? 'soft' : 'secondary'} onPress={() => setResponse(t)} />)}
      </View>
      {hasBills && bills.length ? (
        <Card padded={false} style={{ overflow: 'hidden' }}>
          {bills.map((b, i) => <BillRow key={b.id} bill={b} first={i === 0} />)}
        </Card>
      ) : null}
    </Sheet>
  );
}
