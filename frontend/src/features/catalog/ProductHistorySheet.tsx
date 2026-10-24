/**
 * Item history: every saved change is a version (who, when, what). Any earlier version can be restored;
 * the restore is recorded as a new version, so nothing is ever lost.
 */
import React, { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { menuHistoryApi, type ProductVersion } from '@/api/menuHistory';
import { errorMessage } from '@/api/client';
import type { Category, Product, SalesChannel } from '@/api/types';
import { useTheme } from '@/theme/ThemeProvider';
import { Badge, Button, EmptyState, ErrorState, Loading, Sheet, Text, toast } from '@/components/ui';
import { confirmTop } from './dialogs';
import { olderOf, priceDiff, snapshotFacts, snapshotPrice, whenLabel } from './history';
import { channelShortName } from './channelPricing';

export function ProductHistorySheet({ product, onClose, onRestored, categories, channels, symbol, unsaved }: {
  product: Product;
  onClose: () => void;
  onRestored: (p: Product) => void;
  categories: Category[];
  channels: SalesChannel[];
  symbol: string;
  /** The editor has unsaved changes (restoring replaces them) */
  unsaved: boolean;
}) {
  const { colors } = useTheme();
  const [versions, setVersions] = useState<ProductVersion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [open, setOpen] = useState<number | null>(null);
  const [restoring, setRestoring] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    menuHistoryApi.list(product.id)
      .then((v) => { if (alive) { setVersions(v); setError(null); } })
      .catch((e) => { if (alive) setError(errorMessage(e)); });
    return () => { alive = false; };
  }, [product.id, attempt]);

  const categoryName = (id: string) => categories.find((c) => c.id === id)?.name;
  const channelName = (code: string) => {
    const c = channels.find((x) => x.code === code);
    return c ? channelShortName(c) : undefined;
  };

  const restore = async (v: ProductVersion) => {
    const ok = await confirmTop({
      title: `Restore version ${v.version}?`,
      message: `“${v.snapshot.name ?? product.name}” goes back to version ${v.version} (${[whenLabel(v.created_at), snapshotPrice(v.snapshot, symbol)].filter(Boolean).join(', ')}). `
        + `This is saved as a new version, so you can undo it from here.${unsaved ? ' Your unsaved changes in the editor will be discarded.' : ''}`,
      confirmLabel: 'Restore this version',
    });
    if (!ok) return;
    setRestoring(v.version);
    try {
      const saved = await menuHistoryApi.restore(product.id, v.version);
      onRestored(saved);
      toast.success(`Restored version ${v.version}`);
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setRestoring(null);
    }
  };

  return (
    <Sheet visible onClose={onClose} title="Item history" subtitle={`${product.name} · every change is kept`} width={640} dismissable={restoring === null}>
      {!versions && !error ? <Loading label="Loading history…" /> : null}
      {error && !versions ? <ErrorState message={error} onRetry={() => setAttempt((n) => n + 1)} /> : null}
      {versions && !versions.length ? (
        <EmptyState icon="time-outline" title="No changes recorded yet" message="From now on, every change to this item is kept here with who made it and when." />
      ) : null}
      {versions?.length ? (
        <View>
          {versions.map((v, i) => {
            const older = olderOf(versions, i);
            const diff = priceDiff(v.snapshot, older?.snapshot, symbol);
            const latest = i === 0;
            const removed = v.snapshot.is_active === false;
            const expanded = open === v.version;
            const facts = expanded ? snapshotFacts(v.snapshot, { symbol, categoryName, channelName }) : [];
            return (
              <View key={v.version} style={styles.entry}>
                <View style={styles.rail}>
                  <View style={[styles.dot, { backgroundColor: latest ? colors.primary : colors.surface, borderColor: latest ? colors.primary : colors.borderStrong }]} />
                  {i < versions.length - 1 ? <View style={[styles.line, { backgroundColor: colors.border }]} /> : null}
                </View>
                <View style={{ flex: 1, minWidth: 0, paddingBottom: 18, gap: 4 }}>
                  <Pressable onPress={() => setOpen(expanded ? null : v.version)} accessibilityRole="button" accessibilityState={{ expanded }}
                    accessibilityLabel={`Version ${v.version}: ${v.change}. ${expanded ? 'Hide' : 'Show'} details`}
                    style={[{ gap: 4 }, Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}>
                    <View style={styles.titleRow}>
                      <Text variant="bodyStrong" style={{ flexShrink: 1 }}>{v.change}</Text>
                      {latest ? <Badge label="Current" tone="primary" /> : null}
                      {removed ? <Badge label="Removed" tone="danger" /> : null}
                    </View>
                    <Text variant="small" tone="muted">
                      {[`Version ${v.version}`, whenLabel(v.created_at), v.changed_by ? `by ${v.changed_by}` : null].filter(Boolean).join(' · ')}
                    </Text>
                    {diff ? (
                      <View style={styles.diff}>
                        <Text variant="small" tone="subtle" style={{ textDecorationLine: 'line-through' }}>{diff.from}</Text>
                        <Ionicons name="arrow-forward" size={13} color={colors.textSubtle} />
                        <Text variant="smallStrong" tone={diff.up ? 'warning' : 'success'}>{diff.to}</Text>
                      </View>
                    ) : null}
                  </Pressable>
                  {expanded ? (
                    <View style={[styles.facts, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
                      {facts.map((f) => (
                        <View key={f.label} style={styles.fact}>
                          <Text variant="small" tone="subtle" style={{ width: 96 }}>{f.label}</Text>
                          <Text variant="small" style={{ flex: 1 }}>{f.value}</Text>
                        </View>
                      ))}
                      {!latest ? (
                        <Button title="Restore this version" icon="arrow-undo-outline" size="sm" variant="secondary" style={{ alignSelf: 'flex-start', marginTop: 4 }}
                          onPress={() => void restore(v)} loading={restoring === v.version} disabled={restoring !== null} />
                      ) : (
                        <Text variant="small" tone="subtle">This is how the item is now.</Text>
                      )}
                    </View>
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  entry: { flexDirection: 'row', gap: 12 },
  rail: { width: 14, alignItems: 'center' },
  dot: { width: 12, height: 12, borderRadius: 6, borderWidth: 2, marginTop: 5 },
  line: { width: 2, flex: 1, marginTop: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  diff: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  facts: { borderWidth: 1, borderRadius: 10, padding: 10, gap: 6, marginTop: 4 },
  fact: { flexDirection: 'row', gap: 8 },
});
