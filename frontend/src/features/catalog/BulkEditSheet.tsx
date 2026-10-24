/**
 * Bulk changes for the items selected on Menu & items (SelectionBar): counter price, tax class, category,
 * show/hide on a channel, remove and bring back. One POST /taxes/assign for the tax class; everything else goes
 * through POST /catalog/products/bulk (one transaction per chunk of 250, each item still versioned). Only price
 * changes the bulk endpoint can't mirror exactly (set / ₹ on items with options) fall back to one request per item.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { catalogApi } from '@/api/endpoints';
import { errorMessage } from '@/api/client';
import type { Category, Product, SalesChannel } from '@/api/types';
import { formatRate, loadTaxOverview, taxesApi, type TaxOverview } from '@/api/taxes';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import { Button, Input, Segmented, Sheet, SwitchRow, Text, toast } from '@/components/ui';
import { money } from '@/lib/format';
import { ChoiceChips, Field } from './components';
import { channelShortName } from './channelPricing';
import {
  bulkCoversPrice, bulkPriceAction, chunk, parsePriceOp, planPrice, resultLine, runPool, withChannelAvailability, type PriceOp,
} from './bulk';
import type { BulkProductsBody } from '@/api/endpoints';
import { plural } from './utils';

export type BulkKind = 'price' | 'tax' | 'category' | 'channel' | 'remove' | 'restore';

const TITLES: Record<BulkKind, string> = {
  price: 'Change prices',
  tax: 'Set tax class',
  category: 'Move to category',
  channel: 'Show or hide on a menu',
  remove: 'Remove from the menu',
  restore: 'Bring back to the menu',
};

interface Failure { product: Product; error: string }

const BULK_CHUNK = 250;

export function BulkEditSheet({ kind, products, categories, channels, symbol, onClose, onSaved, onDone }: {
  kind: BulkKind;
  /** The selected items */
  products: Product[];
  categories: Category[];
  /** Delivery apps / online channels with their own menu */
  channels: SalesChannel[];
  symbol: string;
  onClose: () => void;
  /** Saved items (merged into the list and the offline cache) */
  onSaved: (items: Product[]) => void;
  /** Called after a run: ids that succeeded (the screen clears them from the selection) */
  onDone: (okIds: string[]) => void;
}) {
  const { colors } = useTheme();
  const { isPhone } = useLayout();
  const [phase, setPhase] = useState<'form' | 'running' | 'result'>('form');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [okCount, setOkCount] = useState(0);
  const [failures, setFailures] = useState<Failure[]>([]);
  const [targets, setTargets] = useState<Product[]>(products);
  const stop = useRef({ cancelled: false });

  // Price form
  const [mode, setMode] = useState<PriceOp['mode']>('percent');
  const [amount, setAmount] = useState('');
  const [round, setRound] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Tax
  const [tax, setTax] = useState<TaxOverview | null>(null);
  const [taxError, setTaxError] = useState<string | null>(null);
  const [taxClass, setTaxClass] = useState<string>('');
  // Category
  const [categoryId, setCategoryId] = useState<string | null>(categories[0]?.id ?? null);
  // Channel
  const [channelCode, setChannelCode] = useState<string>(channels[0]?.code ?? 'POS');
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (kind !== 'tax') return;
    let alive = true;
    loadTaxOverview().then((t) => { if (alive) setTax(t); }).catch((e) => { if (alive) setTaxError(errorMessage(e)); });
    return () => { alive = false; };
  }, [kind]);

  const parsed = kind === 'price' ? parsePriceOp(mode, amount, round) : null;
  const op = parsed && 'op' in parsed ? parsed.op : null;
  const plans = useMemo(() => (op ? products.map((p) => ({ product: p, plan: planPrice(p, op) })) : []), [products, op]);
  const priceChanges = plans.filter((x) => x.plan.body).length;

  const channelChoices = [{ code: 'POS', label: 'Counter (billing)' }, ...channels.map((c) => ({ code: c.code, label: channelShortName(c) }))];
  const channelLabel = channelChoices.find((c) => c.code === channelCode)?.label ?? channelCode;

  /**
   * What one item needs: nothing, a row in the bulk request (with the item as it will look after it, for the list
   * and the offline cache), or its own request (price changes on items with options the bulk endpoint can't mirror).
   */
  type Plan = { kind: 'none' } | { kind: 'bulk'; after: Product } | { kind: 'single'; job: () => Promise<Product> };
  const planFor = (p: Product): Plan => {
    switch (kind) {
      case 'price': {
        const body = op ? planPrice(p, op).body : null;
        if (!body || !op) return { kind: 'none' };
        if (!bulkCoversPrice(p, op)) return { kind: 'single', job: () => catalogApi.updateProduct(p.id, body) };
        const variants = body.variants ? p.variants.map((v) => ({ ...v, price: body.variants!.find((x) => x.id === v.id)?.price ?? v.price })) : p.variants;
        return { kind: 'bulk', after: { ...p, base_price: body.base_price, variants } };
      }
      case 'category':
        return p.category_id === categoryId ? { kind: 'none' } : { kind: 'bulk', after: { ...p, category_id: categoryId } };
      case 'channel': {
        const next = withChannelAvailability(p.channel_prices, channelCode, show);
        return next === null ? { kind: 'none' } : { kind: 'bulk', after: { ...p, channel_prices: next } };
      }
      case 'remove':
        return p.is_active ? { kind: 'bulk', after: { ...p, is_active: false } } : { kind: 'none' };
      case 'restore':
        return p.is_active ? { kind: 'none' } : { kind: 'bulk', after: { ...p, is_active: true } };
      default:
        return { kind: 'none' };
    }
  };

  /** The bulk request body (without ids) for this sheet's change. */
  const bulkBody = (): Omit<BulkProductsBody, 'product_ids'> | null => {
    switch (kind) {
      case 'price': return op ? bulkPriceAction(op) : null;
      case 'category': return { action: 'category', category_id: categoryId };
      case 'channel': return { action: show ? 'channel_show' : 'channel_hide', channel: channelCode };
      case 'remove': return { action: 'remove' };
      case 'restore': return { action: 'restore' };
      default: return null;
    }
  };

  const run = async (list: Product[]) => {
    setError(null);
    if (kind === 'price' && !op) {
      setError(parsed && 'error' in parsed ? parsed.error : 'Enter a value.');
      return;
    }
    stop.current = { cancelled: false };
    setTargets(list);
    setPhase('running');

    if (kind === 'tax') {
      // One request for every item: POST /taxes/assign
      setProgress({ done: 0, total: list.length });
      try {
        const classId = taxClass || null;
        const r = await taxesApi.assign({ tax_class_id: classId, product_ids: list.map((p) => p.id) });
        onSaved(list.map((p) => ({ ...p, tax_class_id: classId, tax_rate: null })));
        setOkCount(r.updated);
        setFailures([]);
        setProgress({ done: list.length, total: list.length });
        onDone(list.map((p) => p.id));
      } catch (e) {
        setOkCount(0);
        setFailures(list.map((p) => ({ product: p, error: errorMessage(e) })));
      }
      setPhase('result');
      return;
    }

    const planned = list.map((p) => ({ p, plan: planFor(p) }));
    const unchangedIds = planned.filter((x) => x.plan.kind === 'none').map((x) => x.p.id);
    const bulkRows = planned.flatMap((x) => (x.plan.kind === 'bulk' ? [{ p: x.p, after: x.plan.after }] : []));
    const singles = planned.flatMap((x) => (x.plan.kind === 'single' ? [{ p: x.p, job: x.plan.job }] : []));
    const body = bulkBody();
    const total = bulkRows.length + singles.length;
    let done = 0;
    const saved: Product[] = [];
    const failed: Failure[] = [];
    setProgress({ done: 0, total });

    // 1. The bulk endpoint, a chunk at a time (one transaction each)
    for (const part of body ? chunk(bulkRows, BULK_CHUNK) : []) {
      if (stop.current.cancelled) {
        part.forEach((x) => failed.push({ product: x.p, error: 'Stopped' }));
      } else {
        try {
          const r = await catalogApi.bulkProducts({ ...body!, product_ids: part.map((x) => x.p.id) });
          const skipped = new Map(r.skipped.map((s) => [s.id, s.reason]));
          for (const x of part) {
            const reason = skipped.get(x.p.id);
            if (reason) failed.push({ product: x.p, error: reason });
            else saved.push(x.after);
          }
        } catch (e) {
          part.forEach((x) => failed.push({ product: x.p, error: errorMessage(e) }));
        }
      }
      done += part.length;
      setProgress({ done, total });
    }

    // 2. Price changes on items with options that the bulk endpoint can't mirror: one request each
    const result = await runPool(singles, (x) => x.job(), {
      concurrency: 4,
      onProgress: (n) => setProgress({ done: done + n, total }),
      errorText: errorMessage,
      signal: stop.current,
    });
    saved.push(...result.ok.map((r) => r.result));
    failed.push(...result.failed.map((f) => ({ product: f.item.p, error: f.error })));

    if (saved.length) onSaved(saved);
    setOkCount(saved.length + unchangedIds.length);
    setFailures(failed);
    onDone([...saved.map((p) => p.id), ...unchangedIds]);
    setPhase('result');
  };

  const verb = kind === 'remove' ? 'removed' : kind === 'restore' ? 'back on the menu' : 'updated';
  useEffect(() => {
    if (phase !== 'result') return;
    if (!failures.length) toast.success(`${plural(okCount, 'item')} ${verb}`);
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const n = products.length;
  const applyLabel = kind === 'remove' ? `Remove ${plural(n, 'item')}` : kind === 'restore' ? `Bring back ${plural(n, 'item')}` : `Apply to ${plural(n, 'item')}`;
  const formFooter = (
    <View style={styles.footer}>
      <Text variant="small" tone="muted" style={{ flex: 1, minWidth: 140 }}>
        {kind === 'price' ? (op ? `${plural(priceChanges, 'item')} will change` : 'Enter a value to preview') : `${plural(n, 'item')} selected`}
      </Text>
      {isPhone ? null : <Button title="Cancel" variant="outline" onPress={onClose} />}
      <Button title={applyLabel} icon={kind === 'remove' ? 'trash-outline' : 'checkmark'} variant={kind === 'remove' ? 'danger' : 'primary'}
        onPress={() => void run(products)} disabled={(kind === 'price' && (!op || !priceChanges)) || (kind === 'tax' && !tax && !taxError)} />
    </View>
  );
  const runningFooter = (
    <View style={styles.footer}>
      <Text variant="small" tone="muted" style={{ flex: 1 }}>Saving {progress.done} of {progress.total}…</Text>
      <Button title="Stop" variant="outline" onPress={() => { stop.current.cancelled = true; }} />
    </View>
  );
  const resultFooter = (
    <View style={styles.footer}>
      <View style={{ flex: 1 }} />
      {failures.length ? <Button title={`Retry ${failures.length} failed`} icon="refresh" variant="outline" onPress={() => void run(failures.map((f) => f.product))} /> : null}
      <Button title="Done" icon="checkmark" onPress={onClose} />
    </View>
  );

  const pct = progress.total ? progress.done / progress.total : 0;

  return (
    <Sheet visible onClose={onClose} title={TITLES[kind]} subtitle={plural(n, 'selected item')} width={620} dismissable={phase !== 'running'}
      footer={phase === 'form' ? formFooter : phase === 'running' ? runningFooter : resultFooter}>
      {phase === 'form' ? (
        <>
          {kind === 'price' ? (
            <>
              <Segmented<PriceOp['mode']> value={mode} onChange={(v) => { setMode(v); setError(null); }} options={[
                { value: 'percent', label: isPhone ? '± %' : 'Change by %' },
                { value: 'amount', label: isPhone ? `± ${symbol}` : `Change by ${symbol}` },
                { value: 'set', label: isPhone ? 'Set price' : 'Set one price' },
              ]} />
              <Input autoFocus label={mode === 'set' ? 'New counter price' : mode === 'percent' ? 'Change (%) — use − to lower' : `Change (${symbol}) — use − to lower`}
                prefix={mode === 'percent' ? undefined : symbol} keyboardType="numbers-and-punctuation" value={amount} maxLength={10}
                placeholder={mode === 'percent' ? 'e.g. 5 or -10' : mode === 'amount' ? 'e.g. 10 or -5' : '0'}
                onChangeText={(t) => { setAmount(t.replace(/[^\d.-]/g, '')); setError(null); }} error={error}
                onSubmitEditing={() => void run(products)} />
              {mode === 'percent' ? <SwitchRow title="Round to whole rupees" subtitle="Apps and menus list whole-rupee prices" value={round} onValueChange={setRound} /> : null}
              <Text variant="small" tone="subtle">Items with options (Half / Full) change every option. Delivery-app prices you set by hand are not touched.</Text>
              {op ? (
                <View style={[styles.preview, { borderColor: colors.border }]}>
                  {plans.slice(0, 6).map(({ product, plan }) => (
                    <View key={product.id} style={[styles.previewRow, { borderBottomColor: colors.divider }]}>
                      <Text variant="small" numberOfLines={1} style={{ flex: 1 }}>{product.name}</Text>
                      <Text variant="small" tone="subtle" style={styles.strike}>{money(plan.before, symbol)}</Text>
                      <Ionicons name="arrow-forward" size={12} color={colors.textSubtle} />
                      <Text variant="smallStrong" tone={plan.body ? 'primary' : 'muted'} style={styles.num}>{money(plan.after, symbol)}</Text>
                    </View>
                  ))}
                  {plans.length > 6 ? <Text variant="caption" tone="subtle" style={{ padding: 8 }}>and {plans.length - 6} more</Text> : null}
                </View>
              ) : null}
            </>
          ) : null}

          {kind === 'tax' ? (
            <Field label="GST / tax class" hint={taxError ? `Couldn't load tax classes (${taxError}).` : 'Applies now and to future rate changes of that class. Saved in each item’s history.'}>
              {tax ? (
                <ChoiceChips<string> value={taxClass} onChange={setTaxClass} options={[
                  { value: '', label: 'Business default' },
                  ...tax.classes.filter((c) => c.is_active).map((c) => ({ value: c.id, label: `${c.name} · ${formatRate(c.current_rate)}%` })),
                ]} />
              ) : !taxError ? <Text tone="muted">Loading tax classes…</Text> : null}
            </Field>
          ) : null}

          {kind === 'category' ? (
            <Field label="Move to">
              <ChoiceChips<string | null> value={categoryId} onChange={setCategoryId}
                options={[...categories.map((c) => ({ value: c.id as string | null, label: c.name })), { value: null, label: 'No category' }]} />
            </Field>
          ) : null}

          {kind === 'channel' ? (
            <>
              <Field label="Menu">
                <ChoiceChips<string> value={channelCode} onChange={setChannelCode} options={channelChoices.map((c) => ({ value: c.code, label: c.label }))} />
              </Field>
              <Segmented<'hide' | 'show'> value={show ? 'show' : 'hide'} onChange={(v) => setShow(v === 'show')} options={[
                { value: 'hide', label: `Hide on ${channelLabel}`, icon: 'eye-off-outline' },
                { value: 'show', label: `Show on ${channelLabel}`, icon: 'eye-outline' },
              ]} />
              <Text variant="small" tone="subtle">Prices you set for {channelLabel} are kept, so showing an item again restores them.</Text>
            </>
          ) : null}

          {kind === 'remove' ? (
            <Text tone="muted">
              The selected items disappear from billing and every online menu. Past bills keep them and nothing is deleted: bring them back any time from “Removed”.
            </Text>
          ) : null}
          {kind === 'restore' ? <Text tone="muted">The selected items go back on billing and the menus they were on before.</Text> : null}
        </>
      ) : (
        <View style={{ gap: 14 }}>
          <View style={{ gap: 8 }} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: progress.total, now: progress.done }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text variant="bodyStrong">{phase === 'running' ? 'Saving…' : resultLine(okCount, failures.length, verb)}</Text>
              <Text variant="small" tone="muted" style={styles.num}>{progress.done} / {progress.total}</Text>
            </View>
            <View style={[styles.track, { backgroundColor: colors.surfaceSunken }]}>
              <View style={[styles.fill, { width: `${Math.round(pct * 100)}%`, backgroundColor: failures.length && phase === 'result' ? colors.warning : colors.primary }]} />
            </View>
          </View>
          {phase === 'result' && failures.length ? (
            <View style={{ gap: 8 }}>
              <Text variant="smallStrong" tone="danger">Not saved ({failures.length})</Text>
              <ScrollView style={[styles.failures, { borderColor: colors.border }]} nestedScrollEnabled>
                {failures.map((f) => (
                  <View key={f.product.id} style={[styles.previewRow, { borderBottomColor: colors.divider }]}>
                    <Ionicons name="alert-circle" size={16} color={colors.danger} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text variant="small" numberOfLines={1}>{f.product.name}</Text>
                      <Text variant="caption" tone="subtle" numberOfLines={2}>{f.error}</Text>
                    </View>
                  </View>
                ))}
              </ScrollView>
              <Text variant="small" tone="subtle">The rest were saved. Check your connection and retry the failed ones — they stay selected.</Text>
            </View>
          ) : null}
          {phase === 'result' && !failures.length ? (
            <Text tone="muted">{`All ${plural(targets.length, 'item')} done.`}</Text>
          ) : null}
        </View>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  footer: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  preview: { borderWidth: 1, borderRadius: 12, overflow: 'hidden' },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, minHeight: 40, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth * 2 },
  strike: { textDecorationLine: 'line-through', fontVariant: ['tabular-nums'] },
  num: { fontVariant: ['tabular-nums'] },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4 },
  failures: { maxHeight: 220, borderWidth: 1, borderRadius: 12 },
});
