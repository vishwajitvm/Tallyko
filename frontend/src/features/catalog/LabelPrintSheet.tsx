import React, { useMemo, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { catalogApi } from '@/api/endpoints';
import { errorMessage } from '@/api/client';
import type { BusinessSettings, Product } from '@/api/types';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import { Badge, Button, EmptyState, Input, Sheet, SwitchRow, Text, toast } from '@/components/ui';
import { printHtml } from '@/lib/print/printers';
import { Checkbox, ChoiceChips, Field, Stepper } from './components';
import { LABEL_LAYOUTS, barcodeFormatFor, buildLabelsHtml, countLabels, type LabelLayout } from './labels';
import { plural, priceLabel } from './utils';

interface Props {
  visible: boolean;
  onClose: () => void;
  products: Product[]; // active
  preselect: string[];
  settings: BusinessSettings | null;
  onProducts: (items: Product[]) => void;
}

/** Choose products + copies, then print a sheet of barcode labels through the system print dialog. */
export function LabelPrintSheet({ visible, onClose, products, preselect, settings, onProducts }: Props) {
  const { colors } = useTheme();
  const { isPhone, height } = useLayout();
  const symbol = settings?.currency_symbol || '₹';
  const [copies, setCopies] = useState<Record<string, number>>(() => Object.fromEntries(preselect.map((id) => [id, 1])));
  const [query, setQuery] = useState('');
  const [layout, setLayout] = useState<LabelLayout>('a4-24');
  const [showPrice, setShowPrice] = useState(true);
  const [busy, setBusy] = useState<null | 'print' | 'generate'>(null);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = products.filter((p) => !q || p.name.toLowerCase().includes(q) || (p.barcode ?? '').includes(q) || (p.sku ?? '').toLowerCase().includes(q));
    // Preselected first, then items with barcodes
    return rows.sort((a, b) => Number(!!copies[b.id]) - Number(!!copies[a.id]) || Number(!!b.barcode) - Number(!!a.barcode) || a.name.localeCompare(b.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, query]);

  const chosen = products.filter((p) => copies[p.id]);
  const missing = chosen.filter((p) => !p.barcode || !barcodeFormatFor(p.barcode));
  const printable = chosen.filter((p) => p.barcode && barcodeFormatFor(p.barcode));
  const items = printable.map((p) => ({ name: p.name, price: p.variants.length ? null : p.base_price, barcode: p.barcode!, copies: copies[p.id] ?? 1 }));
  const total = countLabels(items);

  const toggle = (id: string, on: boolean) => setCopies((c) => {
    const next = { ...c };
    if (on) next[id] = next[id] || 1;
    else delete next[id];
    return next;
  });

  const generateMissing = async () => {
    const targets = missing.filter((p) => !p.barcode);
    if (!targets.length) return;
    setBusy('generate');
    const done: Product[] = [];
    let failed = 0;
    for (const p of targets) {
      try {
        done.push(await catalogApi.generateBarcode(p.id));
      } catch {
        failed += 1;
      }
    }
    onProducts(done);
    setBusy(null);
    if (done.length) toast.success(`Generated ${plural(done.length, 'barcode')}`);
    if (failed) toast.error(`${plural(failed, 'item')} could not get a barcode. Try again.`);
  };

  const print = async () => {
    if (!total) return;
    setBusy('print');
    try {
      await printHtml(buildLabelsHtml(items, { layout, symbol, businessName: settings?.business_name, showPrice }));
    } catch (e) {
      const msg = errorMessage(e);
      if (!/cancel/i.test(msg)) toast.error(msg);
    } finally {
      setBusy(null);
    }
  };

  const footer = (
    <View style={styles.footer}>
      <Text tone="muted" style={{ flex: 1 }}>{total ? `${plural(total, 'label')} from ${plural(printable.length, 'item')}` : 'Pick items with a barcode'}</Text>
      <Button title="Print labels" icon="print-outline" onPress={print} loading={busy === 'print'} disabled={!total || busy !== null} />
    </View>
  );

  return (
    <Sheet visible={visible} onClose={onClose} title="Print barcode labels" subtitle="Stick them on shelves or packed items, then scan at billing" width={720} footer={footer} scroll={false}>
      <Field label="Label size">
        <ChoiceChips<LabelLayout> value={layout} onChange={setLayout} options={LABEL_LAYOUTS.map((l) => ({ value: l.value, label: l.label }))} />
        <Text variant="small" tone="subtle">{LABEL_LAYOUTS.find((l) => l.value === layout)?.hint}</Text>
      </Field>
      <SwitchRow title="Show price on label" subtitle="Items with options print without a price" value={showPrice} onValueChange={setShowPrice} />
      {missing.length ? (
        <View style={[styles.warn, { backgroundColor: colors.warningSoft, borderColor: colors.warning }]}>
          <Text tone="warning" style={{ flex: 1 }}>{plural(missing.length, 'selected item')} {missing.length === 1 ? 'has' : 'have'} no printable barcode and will be skipped.</Text>
          {missing.some((p) => !p.barcode) ? (
            <Button title="Generate barcodes" size="sm" icon="sparkles-outline" onPress={generateMissing} loading={busy === 'generate'} disabled={busy !== null} />
          ) : null}
        </View>
      ) : null}
      <Input icon="search" placeholder="Search items" value={query} onChangeText={setQuery} accessibilityLabel="Search items" />
      {list.length === 0 ? (
        <EmptyState icon="pricetags-outline" title="No items" message={query ? 'Nothing matches your search.' : 'Add items to your menu first.'} />
      ) : (
        <FlatList
          data={list}
          keyExtractor={(p) => p.id}
          style={{ maxHeight: isPhone ? height * 0.42 : height * 0.4, borderWidth: 1, borderColor: colors.border, borderRadius: 12 }}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item: p, index }) => {
            const on = !!copies[p.id];
            return (
              <View style={[styles.row, index > 0 && { borderTopWidth: 1, borderTopColor: colors.divider }]}>
                <Checkbox checked={on} onChange={(v) => toggle(p.id, v)} label={`Print labels for ${p.name}`} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text variant="bodyStrong" numberOfLines={1}>{p.name}</Text>
                  <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Text variant="small" tone="muted">{priceLabel(p, symbol)}</Text>
                    {p.barcode ? <Text variant="small" tone="subtle">· {p.barcode}</Text> : <Badge label="No barcode" tone="warning" />}
                  </View>
                </View>
                {on ? <Stepper value={copies[p.id] ?? 1} min={1} max={500} label={`copies of ${p.name}`} onChange={(v) => setCopies((c) => ({ ...c, [p.id]: v }))} /> : null}
              </View>
            );
          }}
        />
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  footer: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingRight: 10, paddingVertical: 4, minHeight: 56 },
  warn: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 12, padding: 12, flexWrap: 'wrap' },
});
