import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { Button, Chip, IconButton, Input, Text } from '@/components/ui';
import { VARIANT_PRESETS, localKey, sanitizeMoney } from './utils';

export interface VariantDraft { key: string; id?: string; name: string; price: string }
export type VariantErrors = Record<string, { name?: string; price?: string }>;

export const MAX_VARIANTS = 20;

export function VariantsEditor({ variants, onChange, errors, symbol, compact }: {
  variants: VariantDraft[]; onChange: (v: VariantDraft[]) => void; errors: VariantErrors; symbol: string; compact?: boolean;
}) {
  const { colors } = useTheme();
  const update = (key: string, patch: Partial<VariantDraft>) => onChange(variants.map((v) => (v.key === key ? { ...v, ...patch } : v)));
  const remove = (key: string) => onChange(variants.filter((v) => v.key !== key));
  const add = (name = '') => {
    if (variants.length >= MAX_VARIANTS) return;
    onChange([...variants, { key: localKey('v'), name, price: '' }]);
  };
  const applyPreset = (names: string[]) => {
    // Keep prices the owner already typed for options with the same name
    const byName = new Map(variants.map((v) => [v.name.trim().toLowerCase(), v]));
    onChange(names.map((n) => byName.get(n.toLowerCase()) ?? { key: localKey('v'), name: n, price: '' }));
  };

  return (
    <View style={{ gap: 10 }}>
      {variants.length === 0 ? (
        <Text variant="small" tone="muted">
          Add options when one item is sold in different sizes or portions — like Half / Full plate or Small / Large cup. Each option has its own price.
        </Text>
      ) : (
        <View style={{ gap: 8 }}>
          {variants.map((v, i) => {
            const err = errors[v.key];
            return (
              <View key={v.key} style={styles.row}>
                <Input
                  containerStyle={{ flex: 1.4 }}
                  placeholder={i === 0 ? 'e.g. Half' : 'Option name'}
                  value={v.name}
                  onChangeText={(t) => update(v.key, { name: t })}
                  error={err?.name}
                  maxLength={40}
                  accessibilityLabel={`Option ${i + 1} name`}
                />
                <Input
                  containerStyle={{ flex: 1 }}
                  placeholder="0"
                  prefix={symbol}
                  value={v.price}
                  onChangeText={(t) => update(v.key, { price: sanitizeMoney(t) })}
                  keyboardType="decimal-pad"
                  error={err?.price}
                  accessibilityLabel={`Option ${i + 1} price`}
                />
                <IconButton icon="close" accessibilityLabel={`Remove option ${v.name || i + 1}`} onPress={() => remove(v.key)} />
              </View>
            );
          })}
        </View>
      )}
      <View style={[styles.presets, compact && { gap: 6 }]}>
        <Button title="Add option" icon="add" size="sm" variant="secondary" onPress={() => add()} disabled={variants.length >= MAX_VARIANTS} />
        {VARIANT_PRESETS.map((p) => (
          <Chip key={p.label} label={p.label} icon="flash-outline" onPress={() => applyPreset(p.names)} />
        ))}
      </View>
      {variants.length >= MAX_VARIANTS ? <Text variant="small" tone="warning">You can add up to {MAX_VARIANTS} options.</Text> : null}
      {variants.length > 0 ? (
        <View style={[styles.note, { backgroundColor: colors.infoSoft }]}>
          <Text variant="small" tone="info">Prices are the full selling price of each option (not an add-on).</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  note: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
});
