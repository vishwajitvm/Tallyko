import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { Badge, Button, Card, Text, confirm, toast } from '@/components/ui';
import { useOutbox, type QueuedOrder } from '@/store/outbox';
import { useAuth } from '@/store/auth';
import { useData } from '@/store/data';
import { useNet, syncNow } from '@/lib/sync';
import { formatDateTime, money } from '@/lib/format';

/** Bills saved on this device while offline: waiting to sync, or rejected by the server and needing a decision. */
export function OfflineBills() {
  const { colors, radius } = useTheme();
  const tenantId = useAuth((s) => s.session?.tenantId);
  const allQueue = useOutbox((s) => s.queue);
  const pushing = useOutbox((s) => s.pushing);
  const online = useNet((s) => s.online && s.serverReachable);
  const sym = useData((s) => s.settings?.currency_symbol) ?? '₹';
  const [syncing, setSyncing] = useState(false);
  const queue = allQueue.filter((q) => q.tenantId === tenantId);
  if (!queue.length) return null;

  const pending = queue.filter((q) => !q.failed);
  const failed = queue.filter((q) => q.failed);

  const sync = async () => {
    setSyncing(true);
    try {
      await syncNow();
      const left = useOutbox.getState().queue.filter((q) => q.tenantId === tenantId);
      if (!left.length) toast.success('All offline bills are synced');
      else if (!useNet.getState().serverReachable) toast.warning('Still offline — bills will sync automatically when you are back online');
    } finally {
      setSyncing(false);
    }
  };

  const retry = async (q: QueuedOrder) => {
    useOutbox.getState().retry(q.id);
    await sync();
  };

  const discard = async (q: QueuedOrder) => {
    const ok = await confirm({
      title: 'Discard this offline bill?',
      message: `${q.preview.label} · ${money(q.preview.total, sym)} will be deleted from this device and never reach your sales. Make sure you re-enter it if the sale happened.`,
      confirmLabel: 'Discard bill', danger: true,
    });
    if (!ok) return;
    useOutbox.getState().discard(q.id);
    toast.info('Offline bill discarded');
  };

  return (
    <Card style={{ gap: 12, borderColor: failed.length ? colors.danger : colors.border }}>
      <View style={styles.head}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="h3">Offline bills</Text>
          <Text variant="small" tone="muted" numberOfLines={2}>
            {pending.length ? `${pending.length} waiting to sync` : ''}{pending.length && failed.length ? ' · ' : ''}
            {failed.length ? `${failed.length} need${failed.length === 1 ? 's' : ''} attention` : ''}
            {!online ? ' · you are offline' : ''}
          </Text>
        </View>
        <Button title="Sync now" icon="sync" size="sm" variant="secondary" onPress={sync} loading={syncing || pushing} disabled={syncing || pushing} />
      </View>
      {queue.map((q) => (
        <View key={q.id} style={[styles.row, { borderColor: q.failed ? colors.dangerSoft : colors.divider, backgroundColor: q.failed ? colors.dangerSoft : colors.surfaceAlt, borderRadius: radius.md }]}>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <Text variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>{q.preview.label}</Text>
              {q.failed ? <Badge label="Failed" tone="danger" /> : <Badge label="Waiting to sync" tone="info" icon="cloud-upload-outline" />}
            </View>
            <Text variant="small" tone="muted" numberOfLines={1}>
              {formatDateTime(q.createdAt)} · {q.preview.itemCount} item{q.preview.itemCount === 1 ? '' : 's'}{q.attempts ? ` · ${q.attempts} attempt${q.attempts === 1 ? '' : 's'}` : ''}
            </Text>
            {q.lastError ? <Text variant="small" tone="danger" numberOfLines={3}>{q.lastError}</Text> : null}
          </View>
          <View style={{ alignItems: 'flex-end', gap: 6 }}>
            <Text variant="money">{money(q.preview.total, sym)}</Text>
            {q.failed ? (
              <View style={{ flexDirection: 'row', gap: 6 }}>
                <Button title="Discard" size="sm" variant="ghost" onPress={() => void discard(q)} disabled={syncing} />
                <Button title="Retry" size="sm" variant="secondary" icon="refresh" onPress={() => void retry(q)} disabled={syncing} />
              </View>
            ) : null}
          </View>
        </View>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  row: { flexDirection: 'row', gap: 12, padding: 12, borderWidth: 1, alignItems: 'center', flexWrap: 'wrap' },
});
