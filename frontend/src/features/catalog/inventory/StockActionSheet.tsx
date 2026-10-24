import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { inventoryApi } from '@/api/endpoints';
import { errorMessage } from '@/api/client';
import type { StockRow } from '@/api/types';
import { useTheme } from '@/theme/ThemeProvider';
import { Button, Input, Segmented, Sheet, Text, toast } from '@/components/ui';
import { money } from '@/lib/format';
import { ChoiceChips, Field } from '../components';
import { moneyInput, parseIntOrNull, parseMoney, sanitizeInt, sanitizeMoney } from '../utils';

export type StockAction = 'restock' | 'wastage' | 'adjust';

const WASTE_REASONS = ['Expired', 'Damaged', 'Spilled / spoiled', 'Staff meal', 'Other'] as const;

export function StockActionSheet({ row, action, symbol, onClose, onDone }: {
  row: StockRow; action: StockAction; symbol: string; onClose: () => void; onDone: () => void;
}) {
  const { colors } = useTheme();
  const [qty, setQty] = useState('');
  const [cost, setCost] = useState(moneyInput(row.cost_price));
  const [note, setNote] = useState('');
  const [wasteReason, setWasteReason] = useState<string>('Expired');
  const [adjustMode, setAdjustMode] = useState<'count' | 'delta'>('count');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const n = parseIntOrNull(qty);
  let change: number | null = null;
  if (action === 'restock') change = n !== null && n > 0 ? n : null;
  else if (action === 'wastage') change = n !== null && n > 0 ? -n : null;
  else if (adjustMode === 'count') change = n !== null && n >= 0 ? n - row.stock : null;
  else change = n !== null && n !== 0 ? n : null;
  const after = change !== null ? row.stock + change : null;

  const title = { restock: 'Add stock', wastage: 'Record wastage', adjust: 'Adjust stock' }[action];
  const unit = row.unit || 'pcs';

  const submit = async () => {
    setError(null);
    if (n === null || qty.trim() === '' || qty === '-') return setError('Enter a quantity.');
    if (change === null) {
      return setError(action === 'adjust' && adjustMode === 'delta' ? 'Enter a number other than 0 (use − to remove).' : 'Quantity must be more than 0.');
    }
    if (change === 0) return setError('That matches the current stock — nothing to change.');
    const unitCost = action === 'restock' ? parseMoney(cost) : null;
    const parts: string[] = [];
    if (action === 'wastage') parts.push(wasteReason);
    if (action === 'adjust' && adjustMode === 'count') parts.push(`Counted ${n} (was ${row.stock})`);
    if (note.trim()) parts.push(note.trim());
    setBusy(true);
    try {
      await inventoryApi.adjust({
        product_id: row.id,
        quantity: change,
        reason: action === 'restock' ? 'restock' : action === 'wastage' ? 'wastage' : 'adjustment',
        note: parts.join(' · ').slice(0, 200) || undefined,
        ...(unitCost !== null ? { unit_cost: unitCost } : {}),
      });
      toast.success(`${row.name}: ${row.stock} → ${after} ${unit}`);
      onDone();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible onClose={busy ? () => {} : onClose} title={title} subtitle={row.name} width={480} dismissable={!busy}
      footer={
        <View style={styles.footer}>
          <Button title="Cancel" variant="secondary" onPress={onClose} disabled={busy} />
          <Button title={title} variant={action === 'wastage' ? 'danger' : 'primary'} onPress={submit} loading={busy} disabled={busy || change === null || change === 0} />
        </View>
      }>
      <View style={[styles.now, { backgroundColor: colors.surfaceSunken }]}>
        <View style={{ flex: 1 }}>
          <Text variant="small" tone="muted">In stock now</Text>
          <Text variant="h2">{row.stock} {unit}</Text>
        </View>
        {after !== null && change !== 0 ? (
          <View style={{ alignItems: 'flex-end' }}>
            <Text variant="small" tone="muted">After</Text>
            <Text variant="h2" tone={after < 0 ? 'danger' : after <= row.low_stock_threshold ? 'warning' : 'success'}>{after} {unit}</Text>
          </View>
        ) : null}
      </View>

      {action === 'adjust' ? (
        <Segmented<'count' | 'delta'> value={adjustMode} onChange={(v) => { setAdjustMode(v); setQty(''); setError(null); }}
          options={[{ value: 'count', label: 'Set counted quantity' }, { value: 'delta', label: 'Add / remove' }]} />
      ) : null}

      <Input
        label={action === 'restock' ? `Quantity received (${unit})` : action === 'wastage' ? `Quantity wasted (${unit})` : adjustMode === 'count' ? `Counted quantity (${unit})` : `Change (${unit}) — use − to remove`}
        required
        autoFocus
        keyboardType={action === 'adjust' && adjustMode === 'delta' ? 'numbers-and-punctuation' : 'number-pad'}
        placeholder={action === 'adjust' && adjustMode === 'delta' ? 'e.g. -2 or 5' : '0'}
        value={qty}
        onChangeText={(t) => { setQty(sanitizeInt(t, action === 'adjust' && adjustMode === 'delta')); setError(null); }}
        onSubmitEditing={submit}
        error={error}
        hint={
          action === 'adjust' && adjustMode === 'count' && change !== null
            ? change === 0 ? 'Matches current stock' : `Difference: ${change > 0 ? '+' : ''}${change} ${unit}`
            : action === 'wastage' && n !== null && n > row.stock ? 'More than what is in stock — stock will go below zero.' : undefined
        }
      />

      {action === 'restock' ? (
        <Input label="Cost per unit" prefix={symbol} placeholder="Optional" keyboardType="decimal-pad" value={cost}
          onChangeText={(t) => setCost(sanitizeMoney(t))}
          hint={parseMoney(cost) !== null && n ? `Total ${money((parseMoney(cost) ?? 0) * n, symbol)} · updates the item's cost price` : 'Updates the item’s cost price for stock value and profit'} />
      ) : null}

      {action === 'wastage' ? (
        <Field label="Reason">
          <ChoiceChips<string> value={wasteReason} onChange={setWasteReason} options={WASTE_REASONS.map((r) => ({ value: r, label: r }))} />
        </Field>
      ) : null}

      <Input label="Note" placeholder={action === 'restock' ? 'e.g. Supplier, bill no.' : action === 'wastage' ? 'Optional details' : 'e.g. Monthly stock count'}
        value={note} onChangeText={setNote} maxLength={120} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  footer: { flexDirection: 'row', gap: 10, justifyContent: 'flex-end' },
  now: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, padding: 14, gap: 12 },
});
