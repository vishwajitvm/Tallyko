import React, { memo } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme/ThemeProvider';
import { Badge, Button, IconButton, Input, Text, VegMark } from '@/components/ui';
import { Checkbox } from '../components';
import { localKey, sanitizeMoney } from '../utils';
import { LOW_CONFIDENCE, problemText, rowProblems, type ReviewRow, type ReviewVariant } from './review';

interface Props {
  row: ReviewRow;
  index: number;
  wide: boolean;
  symbol: string;
  showVeg: boolean;
  duplicate: boolean;
  onChange: (key: string, patch: Partial<ReviewRow>) => void;
  onRemove: (key: string) => void;
}

export const ReviewRowItem = memo(function ReviewRowItem({ row, index, wide, symbol, showVeg, duplicate, onChange, onRemove }: Props) {
  const { colors } = useTheme();
  const problems = rowProblems(row);
  const problem = row.include ? problemText(problems) : null;
  const low = row.confidence !== null && row.confidence < LOW_CONFIDENCE;
  const label = row.name || `row ${index + 1}`;
  const accent = problem ? colors.danger : low && row.include ? colors.warning : 'transparent';

  const setVariants = (variants: ReviewVariant[]) => onChange(row.key, { variants });
  const updateVariant = (key: string, patch: Partial<ReviewVariant>) => setVariants(row.variants.map((v) => (v.key === key ? { ...v, ...patch } : v)));
  const addVariant = () => {
    if (row.variants.length >= 20) return;
    // Turning a single price into options keeps that price on the first option
    if (!row.variants.length) {
      setVariantsWithPrice([{ key: localKey('sv'), name: 'Half', price: '' }, { key: localKey('sv'), name: 'Full', price: row.price }]);
      return;
    }
    setVariants([...row.variants, { key: localKey('sv'), name: '', price: '' }]);
  };
  const setVariantsWithPrice = (variants: ReviewVariant[]) => onChange(row.key, { variants, price: '' });
  const removeVariant = (key: string) => {
    const left = row.variants.filter((v) => v.key !== key);
    // Last option removed → fall back to a single price
    if (!left.length) onChange(row.key, { variants: [], price: row.variants[0]?.price ?? '' });
    else setVariants(left);
  };
  const cycleVeg = () => onChange(row.key, { isVeg: row.isVeg === null ? true : row.isVeg ? false : null });

  const nameInput = (
    <Input
      containerStyle={{ flex: wide ? 2 : 1 }}
      value={row.name}
      placeholder="Item name"
      onChangeText={(t) => onChange(row.key, { name: t })}
      maxLength={120}
      accessibilityLabel={`Name of ${label}`}
      error={row.include && problems.includes('name') ? ' ' : null}
    />
  );
  const categoryInput = (
    <Input
      containerStyle={{ flex: 1.2 }}
      value={row.category}
      placeholder="Category"
      onChangeText={(t) => onChange(row.key, { category: t })}
      maxLength={60}
      accessibilityLabel={`Category of ${label}`}
    />
  );
  const priceInput = row.variants.length ? (
    <View style={[styles.optionsCell, { width: wide ? 130 : undefined, flex: wide ? undefined : 1, backgroundColor: colors.surfaceSunken, borderColor: colors.border }]}>
      <Text variant="small" tone="muted" numberOfLines={1}>{row.variants.length} options</Text>
    </View>
  ) : (
    <Input
      containerStyle={{ width: wide ? 130 : undefined, flex: wide ? undefined : 1 }}
      value={row.price}
      prefix={symbol}
      placeholder="Price"
      keyboardType="decimal-pad"
      onChangeText={(t) => onChange(row.key, { price: sanitizeMoney(t) })}
      accessibilityLabel={`Price of ${label}`}
      error={row.include && problems.includes('price') ? ' ' : null}
    />
  );
  const vegToggle = showVeg ? (
    <Pressable
      onPress={cycleVeg}
      accessibilityRole="button"
      accessibilityLabel={`Food type for ${label}: ${row.isVeg === null ? 'not set' : row.isVeg ? 'veg' : 'non-veg'}. Tap to change`}
      style={({ hovered }: any) => [styles.vegBtn, hovered && { backgroundColor: colors.surfaceSunken }, Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}
    >
      {row.isVeg === null ? <View style={[styles.vegEmpty, { borderColor: colors.borderStrong }]} /> : <VegMark veg={row.isVeg} size={16} />}
    </Pressable>
  ) : null;

  const badges = (
    <View style={styles.badges}>
      {problem ? <Badge label={problem} tone="danger" icon="alert-circle" /> : null}
      {row.existing ? <Badge label="Already on menu" tone="neutral" icon="copy-outline" /> : null}
      {duplicate && !row.existing ? <Badge label="Repeated in this list" tone="warning" icon="copy-outline" /> : null}
      {low ? <Badge label={`Check this · ${Math.round((row.confidence ?? 0) * 100)}% sure`} tone="warning" icon="eye-outline" /> : null}
      {row.confidence === null ? <Badge label="Added by you" tone="info" /> : null}
      {!row.variants.length ? (
        <Button title="Add sizes" size="sm" variant="ghost" icon="add" onPress={addVariant} accessibilityLabel={`Add sizes to ${label}`} />
      ) : null}
    </View>
  );

  const variantEditor = row.variants.length ? (
    <View style={styles.variants}>
      {row.variants.map((v, i) => (
        <View key={v.key} style={[styles.variant, { borderColor: colors.border, backgroundColor: colors.surfaceAlt }]}>
          <Input
            containerStyle={{ width: wide ? 120 : 104 }}
            value={v.name}
            placeholder="Size"
            onChangeText={(t) => updateVariant(v.key, { name: t })}
            maxLength={40}
            accessibilityLabel={`Option ${i + 1} name for ${label}`}
            error={row.include && !v.name.trim() ? ' ' : null}
          />
          <Input
            containerStyle={{ width: wide ? 110 : 96 }}
            value={v.price}
            prefix={symbol}
            placeholder="0"
            keyboardType="decimal-pad"
            onChangeText={(t) => updateVariant(v.key, { price: sanitizeMoney(t) })}
            accessibilityLabel={`Option ${i + 1} price for ${label}`}
            error={row.include && !v.price ? ' ' : null}
          />
          <IconButton icon="close" size="sm" accessibilityLabel={`Remove option ${v.name || i + 1} from ${label}`} onPress={() => removeVariant(v.key)} />
        </View>
      ))}
      <Button title="Option" icon="add" size="sm" variant="secondary" onPress={addVariant} disabled={row.variants.length >= 20} accessibilityLabel={`Add option to ${label}`} />
    </View>
  ) : null;

  return (
    <View style={[styles.row, { borderBottomColor: colors.divider, opacity: row.include ? 1 : 0.6 }]}>
      <View style={[styles.accent, { backgroundColor: accent }]} />
      {wide ? (
        <>
          <View style={styles.line}>
            <Checkbox checked={row.include} onChange={(v) => onChange(row.key, { include: v })} label={`Include ${label}`} />
            {vegToggle}
            {nameInput}
            {categoryInput}
            {priceInput}
            <IconButton icon="trash-outline" accessibilityLabel={`Delete ${label}`} onPress={() => onRemove(row.key)} />
          </View>
          <View style={{ paddingLeft: showVeg ? 92 : 48, gap: 8 }}>
            {variantEditor}
            {badges}
          </View>
        </>
      ) : (
        <View style={{ gap: 8 }}>
          <View style={styles.line}>
            <Checkbox checked={row.include} onChange={(v) => onChange(row.key, { include: v })} label={`Include ${label}`} />
            {vegToggle}
            {nameInput}
            <IconButton icon="trash-outline" accessibilityLabel={`Delete ${label}`} onPress={() => onRemove(row.key)} />
          </View>
          <View style={[styles.line, { paddingLeft: 4 }]}>
            {categoryInput}
            {priceInput}
          </View>
          {variantEditor}
          {badges}
        </View>
      )}
    </View>
  );
});

export function ReviewHeader({ showVeg }: { showVeg: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.head, { borderBottomColor: colors.border, backgroundColor: colors.surfaceAlt }]}>
      <Ionicons name="checkbox-outline" size={14} color={colors.textSubtle} style={{ width: 44, textAlign: 'center' }} />
      {showVeg ? <Text variant="caption" tone="subtle" style={{ width: 36, textAlign: 'center' }}>VEG</Text> : null}
      <Text variant="caption" tone="subtle" style={{ flex: 2 }}>ITEM</Text>
      <Text variant="caption" tone="subtle" style={{ flex: 1.2 }}>CATEGORY</Text>
      <Text variant="caption" tone="subtle" style={{ width: 130 }}>PRICE</Text>
      <View style={{ width: 44 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { paddingVertical: 10, paddingRight: 10, paddingLeft: 6, borderBottomWidth: 1, gap: 8 },
  accent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3 },
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  vegBtn: { width: 36, height: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  vegEmpty: { width: 16, height: 16, borderWidth: 1.5, borderStyle: 'dashed', borderRadius: 3 },
  optionsCell: { minHeight: 46, borderWidth: 1, borderRadius: 10, justifyContent: 'center', paddingHorizontal: 12 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  variants: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  variant: { flexDirection: 'row', alignItems: 'flex-start', gap: 4, borderWidth: 1, borderRadius: 12, padding: 4 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 6, paddingRight: 10, height: 34, borderBottomWidth: 1 },
});
