import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { inventoryApi } from '@/api/endpoints';
import { errorMessage } from '@/api/client';
import type { StockRow } from '@/api/types';
import { useTheme } from '@/theme/ThemeProvider';
import { EmptyState, ErrorState, Loading, Sheet, Text } from '@/components/ui';
import { formatDateTime } from '@/lib/format';

interface StockLog { id: string; product_id: string; product_name: string; quantity_change: number; reason: string; note: string | null; created_at: string }

const REASONS: Record<string, { label: string; icon: keyof typeof Ionicons.glyphMap }> = {
  restock: { label: 'Stock added', icon: 'arrow-down-circle-outline' },
  wastage: { label: 'Wastage', icon: 'trash-outline' },
  adjustment: { label: 'Adjustment', icon: 'swap-vertical-outline' },
  return: { label: 'Returned', icon: 'return-down-back-outline' },
  sale: { label: 'Sold', icon: 'receipt-outline' },
};

export function StockHistorySheet({ row, onClose }: { row: StockRow; onClose: () => void }) {
  const { colors } = useTheme();
  const [logs, setLogs] = useState<StockLog[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = (await inventoryApi.logs(row.id)) as StockLog[];
      setLogs(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [row.id]);

  useEffect(() => { void load(); }, [load]);

  const unit = row.unit || 'pcs';
  return (
    <Sheet visible onClose={onClose} title="Stock history" subtitle={`${row.name} · ${row.stock} ${unit} in stock`} width={560}>
      {error ? (
        <ErrorState message={error} onRetry={load} />
      ) : !logs ? (
        <Loading label="Loading history…" />
      ) : logs.length === 0 ? (
        <EmptyState icon="time-outline" title="No movements yet" message="Stock added, sold, wasted or adjusted will show here." />
      ) : (
        <View style={[styles.list, { borderColor: colors.border }]}>
          {logs.map((l, i) => {
            const r = REASONS[l.reason] ?? { label: l.reason, icon: 'ellipse-outline' as const };
            const plus = l.quantity_change > 0;
            return (
              <View key={l.id} style={[styles.row, i > 0 && { borderTopWidth: 1, borderTopColor: colors.divider }]}>
                <View style={[styles.icon, { backgroundColor: plus ? colors.successSoft : colors.dangerSoft }]}>
                  <Ionicons name={r.icon} size={17} color={plus ? colors.success : colors.danger} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text variant="bodyStrong">{r.label}</Text>
                  {l.note ? <Text variant="small" tone="muted" numberOfLines={2}>{l.note}</Text> : null}
                  <Text variant="caption" tone="subtle">{formatDateTime(l.created_at)}</Text>
                </View>
                <Text variant="money" tone={plus ? 'success' : 'danger'}>{plus ? '+' : ''}{l.quantity_change} {unit}</Text>
              </View>
            );
          })}
        </View>
      )}
      {logs && logs.length >= 100 ? <Text variant="small" tone="subtle" align="center">Showing the latest 100 movements</Text> : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  list: { borderWidth: 1, borderRadius: 12, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  icon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
});
