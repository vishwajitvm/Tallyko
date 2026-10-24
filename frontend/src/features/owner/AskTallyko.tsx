/**
 * Requests to Tallyko: the business can never archive or delete its own records; the owner asks and Tallyko's
 * super admin does it (or explains why not). The reply shows up in "Your requests".
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ownerApi, type OwnerRequest, type OwnerRequestKind, type WatchCancelledBill } from '@/api/owner';
import { errorMessage } from '@/api/client';
import type { Order } from '@/api/types';
import { Badge, Button, Card, Chip, Divider, Input, Loading, Segmented, Sheet, Text, toast, type BadgeTone } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { formatDate, formatDateTime, money } from '@/lib/format';
import { plural } from './watchUtils';

const KIND_LABEL: Record<OwnerRequestKind, string> = {
  archive_bills: 'Archive bills',
  delete_bills: 'Delete bills',
  other: 'Other',
};

const KIND_HELP: Record<OwnerRequestKind, string> = {
  archive_bills: 'Tallyko hides these bills from your everyday lists and reports (for example test bills). They stay in the records.',
  delete_bills: 'Tallyko checks the request first. Tax invoices usually have to be kept for several years, so Tallyko may archive them instead.',
  other: 'Tell Tallyko what looks wrong, for example a bill that was cancelled by mistake.',
};

interface PickBill { id: string; bill: string; total: number; at: string | null; note: string }

function fromCancelled(b: WatchCancelledBill): PickBill {
  return { id: b.id, bill: b.bill, total: b.total, at: b.cancelled_at, note: `Cancelled${b.by ? ` by ${b.by}` : ''}${b.reason ? ` · ${b.reason}` : ''}` };
}

function fromOrder(o: Order): PickBill {
  const status = o.status === 'cancelled' ? 'Cancelled' : o.status === 'completed' ? 'Paid' : 'Open';
  return { id: o.id, bill: o.invoice_no || o.code, total: o.total_amount, at: o.created_at,
    note: `${status}${(o as Order & { archived?: boolean }).archived ? ' · archived' : ''}` };
}

export function AskTallykoSheet({ visible, onClose, cancelled, symbol, onSent }: {
  visible: boolean; onClose: () => void; cancelled: WatchCancelledBill[]; symbol: string; onSent: (r: OwnerRequest) => void;
}) {
  const { colors } = useTheme();
  const [kind, setKind] = useState<OwnerRequestKind>('archive_bills');
  const [source, setSource] = useState<'cancelled' | 'recent'>('cancelled');
  const [selected, setSelected] = useState<Record<string, PickBill>>({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [recent, setRecent] = useState<PickBill[] | null>(null);
  const [recentError, setRecentError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setKind('archive_bills');
    setSource(cancelled.length ? 'cancelled' : 'recent');
    setSelected({});
    setMessage('');
    setError(null);
    setSearch('');
  }, [visible, cancelled.length]);

  useEffect(() => {
    if (!visible || source !== 'recent') return undefined;
    let live = true;
    const t = setTimeout(async () => {
      setRecentError(null);
      try {
        const res = await ownerApi.bills({ q: search.trim() || undefined, limit: 50 });
        if (live) setRecent(res.items.map(fromOrder));
      } catch (e) {
        if (live) setRecentError(errorMessage(e));
      }
    }, search ? 350 : 0);
    return () => { live = false; clearTimeout(t); };
  }, [visible, source, search]);

  const list = useMemo(() => (source === 'cancelled' ? cancelled.map(fromCancelled) : recent ?? []), [source, cancelled, recent]);
  const needsBills = kind !== 'other';
  const chosen = Object.values(selected);
  const trimmed = message.trim();
  const problem = needsBills && !chosen.length ? 'Choose the bills' : trimmed.length < 5 ? 'Write a short message (at least 5 characters)' : null;

  const toggle = (b: PickBill) => setSelected((s) => {
    const next = { ...s };
    if (next[b.id]) delete next[b.id]; else next[b.id] = b;
    return next;
  });

  const send = async () => {
    if (problem) { setError(problem); return; }
    setBusy(true);
    setError(null);
    try {
      const row = await ownerApi.ask({ kind, order_ids: needsBills ? chosen.map((b) => b.id) : [], message: trimmed });
      toast.success('Sent to Tallyko. You will see the reply here.');
      onSent(row);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} width={640} title="Ask Tallyko"
      subtitle="Nobody in your business can archive or delete records. Tallyko does it for you on request."
      footer={(
        <View style={styles.footer}>
          <Text variant="small" tone={error ? 'danger' : 'subtle'} style={{ flex: 1, minWidth: 160 }}>
            {error ?? (needsBills ? (chosen.length ? `${plural(chosen.length, 'bill')} selected` : 'No bills selected yet') : ' ')}
          </Text>
          <Button title="Cancel" variant="ghost" onPress={onClose} disabled={busy} />
          <Button title="Send to Tallyko" icon="send" onPress={send} loading={busy} disabled={busy} />
        </View>
      )}>
      <View style={{ gap: 14 }}>
        <Segmented value={kind} onChange={(k) => { setKind(k); setError(null); }}
          options={(Object.keys(KIND_LABEL) as OwnerRequestKind[]).map((k) => ({ value: k, label: KIND_LABEL[k] }))} />
        <Text variant="small" tone="muted">{KIND_HELP[kind]}</Text>

        {needsBills ? (
          <View style={{ gap: 10 }}>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              <Chip label="Cancelled in this period" count={cancelled.length} selected={source === 'cancelled'} onPress={() => setSource('cancelled')} />
              <Chip label="All recent bills" icon="search" selected={source === 'recent'} onPress={() => setSource('recent')} />
            </View>
            {source === 'recent' ? (
              <Input value={search} onChangeText={setSearch} placeholder="Bill number, customer name or phone" icon="search" autoCorrect={false} />
            ) : null}
            <Card padded={false} style={{ maxHeight: 300, overflow: 'hidden' }}>
              {source === 'recent' && recent === null && !recentError ? <Loading label="Loading bills" /> : null}
              {source === 'recent' && recentError ? <Text tone="danger" style={{ padding: 16 }}>{recentError}</Text> : null}
              {list.length === 0 && (source === 'cancelled' || recent !== null) ? (
                <Text tone="subtle" style={{ padding: 16 }}>
                  {source === 'cancelled' ? 'No cancelled bills in this period. Look in All recent bills.' : 'No bills found.'}
                </Text>
              ) : null}
              <View>
                {list.map((b, i) => {
                  const on = !!selected[b.id];
                  return (
                    <View key={b.id}>
                      {i ? <Divider /> : null}
                      <Pressable onPress={() => toggle(b)} accessibilityRole="checkbox" accessibilityState={{ checked: on }}
                        accessibilityLabel={`Bill ${b.bill}`}
                        style={({ hovered }: any) => [styles.pick, (hovered || on) && { backgroundColor: on ? colors.primarySoft : colors.surfaceSunken },
                          Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}>
                        <Ionicons name={on ? 'checkbox' : 'square-outline'} size={22} color={on ? colors.primary : colors.textSubtle} />
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text variant="bodyStrong" numberOfLines={1}>{b.bill}</Text>
                          <Text variant="small" tone="muted" numberOfLines={1}>{[formatDateTime(b.at), b.note].filter(Boolean).join(' · ')}</Text>
                        </View>
                        <Text variant="money">{money(b.total, symbol)}</Text>
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            </Card>
          </View>
        ) : null}

        <Input label="Message to Tallyko" required value={message} onChangeText={(v) => { setMessage(v); if (error) setError(null); }}
          multiline numberOfLines={3} maxLength={1000} style={{ minHeight: 84, textAlignVertical: 'top' }}
          placeholder={kind === 'other' ? 'What happened and what should be corrected?' : 'Why should these bills be archived or deleted? e.g. test bills made while setting up'}
          hint={`${message.length}/1000`} />
      </View>
    </Sheet>
  );
}

const STATUS: Record<string, { label: string; tone: BadgeTone; icon: keyof typeof Ionicons.glyphMap }> = {
  pending: { label: 'Waiting for Tallyko', tone: 'warning', icon: 'time-outline' },
  done: { label: 'Done', tone: 'success', icon: 'checkmark-circle' },
  rejected: { label: 'Not done', tone: 'neutral', icon: 'close-circle-outline' },
};

const ACTION_TAKEN: Record<string, string> = { archived: 'Bills archived', deleted: 'Bills deleted', none: 'No change made' };

export function RequestsCard({ requests, loading, error, onRetry, onAsk }: {
  requests: OwnerRequest[] | null; loading: boolean; error: string | null; onRetry: () => void; onAsk: () => void;
}) {
  const { colors, radius } = useTheme();
  return (
    <Card style={{ gap: 12 }}>
      <View style={styles.cardHead}>
        <View style={{ flex: 1, minWidth: 180 }}>
          <Text variant="h3">Your requests to Tallyko</Text>
          <Text variant="small" tone="muted">Archiving, deleting or correcting records. Tallyko replies here.</Text>
        </View>
        <Button title="New request" size="sm" variant="secondary" icon="add" onPress={onAsk} />
      </View>
      {loading && !requests ? <Loading /> : null}
      {error && !requests ? (
        <View style={{ gap: 8 }}>
          <Text tone="danger" variant="small">{error}</Text>
          <Button title="Try again" size="sm" variant="ghost" icon="refresh" onPress={onRetry} style={{ alignSelf: 'flex-start' }} />
        </View>
      ) : null}
      {requests && requests.length === 0 ? (
        <Text tone="subtle" variant="small">No requests yet. Use Ask Tallyko to archive test bills or report a mistake.</Text>
      ) : null}
      {(requests ?? []).map((r, i) => {
        const st = STATUS[r.status] ?? { label: r.status, tone: 'neutral' as BadgeTone, icon: 'help-circle-outline' as const };
        return (
          <View key={r.id} style={{ gap: 8 }}>
            {i ? <Divider /> : null}
            <View style={styles.reqHead}>
              <Text variant="bodyStrong">{KIND_LABEL[r.kind as OwnerRequestKind] ?? r.kind}</Text>
              <Badge label={st.label} tone={st.tone} icon={st.icon} />
              {r.status === 'done' && r.action_taken ? <Badge label={ACTION_TAKEN[r.action_taken] ?? r.action_taken} tone="info" /> : null}
              <View style={{ flex: 1 }} />
              <Text variant="small" tone="subtle">{formatDate(r.created_at)}</Text>
            </View>
            <Text variant="small" tone="muted">
              {r.order_ids.length ? `${plural(r.order_ids.length, 'bill')} · ` : ''}{r.message}
            </Text>
            {r.response ? (
              <View style={[styles.reply, { backgroundColor: colors.surfaceSunken, borderRadius: radius.md, borderLeftColor: colors.primary }]}>
                <Text variant="caption" tone="subtle">TALLYKO REPLIED{r.handled_at ? ` · ${formatDateTime(r.handled_at)}` : ''}</Text>
                <Text variant="small">{r.response}</Text>
              </View>
            ) : null}
          </View>
        );
      })}
    </Card>
  );
}

const styles = StyleSheet.create({
  footer: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  pick: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10, minHeight: 56 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  reqHead: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  reply: { padding: 12, gap: 4, borderLeftWidth: 3 },
});
