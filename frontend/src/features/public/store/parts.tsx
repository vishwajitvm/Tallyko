import React from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme/ThemeProvider';
import { Text, VegMark } from '@/components/ui';
import { MAX_QTY, type MenuProduct, price } from './model';

const webPointer = Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : null;

/** − qty + control. 44px touch targets. */
export function Stepper({ value, onChange, label, compact, min = 0 }: { value: number; onChange: (next: number) => void; label: string; compact?: boolean; min?: number }) {
  const { colors, radius } = useTheme();
  const size = compact ? 40 : 46;
  return (
    <View style={[styles.stepper, { borderColor: colors.primary, borderRadius: radius.md, backgroundColor: colors.primarySoft }]}>
      <Pressable onPress={() => onChange(Math.max(min, value - 1))} disabled={value <= min} accessibilityRole="button"
        accessibilityLabel={min === 0 && value <= 1 ? `Remove ${label}` : `Remove one ${label}`} hitSlop={4}
        style={({ hovered }: any) => [styles.stepBtn, { width: size, height: size, opacity: value <= min ? 0.4 : 1 }, hovered && { backgroundColor: colors.surfaceSunken }, webPointer]}>
        <Ionicons name={min === 0 && value <= 1 ? 'trash-outline' : 'remove'} size={18} color={colors.primary} />
      </Pressable>
      <Text variant="bodyStrong" tone="primary" style={{ minWidth: 24, textAlign: 'center', fontVariant: ['tabular-nums'] }}
        accessibilityLiveRegion="polite" accessibilityLabel={`${value} in cart`}>{value}</Text>
      <Pressable onPress={() => onChange(Math.min(MAX_QTY, value + 1))} disabled={value >= MAX_QTY} accessibilityRole="button"
        accessibilityLabel={`Add one more ${label}`} hitSlop={4}
        style={({ hovered }: any) => [styles.stepBtn, { width: size, height: size, opacity: value >= MAX_QTY ? 0.4 : 1 }, hovered && { backgroundColor: colors.surfaceSunken }, webPointer]}>
        <Ionicons name="add" size={20} color={colors.primary} />
      </Pressable>
    </View>
  );
}

export function AddButton({ onPress, label, count = 0 }: { onPress: () => void; label: string; count?: number }) {
  const { colors, radius } = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`Add ${label}`}
      style={({ hovered, pressed }: any) => [styles.add, {
        borderRadius: radius.md, borderColor: colors.primary,
        backgroundColor: pressed || hovered ? colors.primary : colors.primarySoft,
      }, webPointer]}>
      {({ hovered, pressed }: any) => (
        <>
          <Text variant="bodyStrong" color={pressed || hovered ? colors.primaryText : colors.primary}>{count > 0 ? `Add · ${count}` : 'Add'}</Text>
          <Ionicons name="add" size={20} color={pressed || hovered ? colors.primaryText : colors.primary} />
        </>
      )}
    </Pressable>
  );
}

export function ProductRow({ product, symbol, qty, canOrder, onAdd, onChangeQty }: {
  product: MenuProduct; symbol: string; qty: number; canOrder: boolean;
  onAdd: () => void; onChangeQty: (next: number) => void;
}) {
  const { colors } = useTheme();
  const hasVariants = product.variants.length > 0;
  const minPrice = hasVariants ? Math.min(...product.variants.map((v) => v.price)) : product.price;
  return (
    <View style={styles.product}>
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <VegMark veg={product.is_veg} />
          <Text variant="h3" style={{ flexShrink: 1 }}>{product.name}</Text>
        </View>
        <Text variant="bodyStrong" style={{ fontVariant: ['tabular-nums'] }}>
          {hasVariants && product.variants.some((v) => v.price !== minPrice) ? <Text variant="small" tone="muted">from </Text> : null}
          {price(minPrice, symbol)}
        </Text>
        {product.description ? <Text variant="small" tone="muted" numberOfLines={3}>{product.description}</Text> : null}
        {hasVariants ? (
          <Text variant="caption" tone="subtle" numberOfLines={1}>{product.variants.map((v) => v.name).join(' · ')}</Text>
        ) : null}
      </View>
      {canOrder ? (
        <View style={{ alignItems: 'flex-end', gap: 4, paddingTop: 2 }}>
          {hasVariants || qty === 0 ? (
            <AddButton onPress={onAdd} label={product.name} count={hasVariants ? qty : 0} />
          ) : (
            <Stepper value={qty} onChange={onChangeQty} label={product.name} />
          )}
          {hasVariants ? (
            <Text variant="caption" tone="subtle">{qty > 0 ? 'Pick another size' : 'Customisable'}</Text>
          ) : null}
        </View>
      ) : null}
      <View style={[styles.divider, { backgroundColor: colors.divider }]} />
    </View>
  );
}

export function ProductSkeleton() {
  const { colors, radius } = useTheme();
  const block = (w: number | `${number}%`, h: number) => <View style={{ width: w, height: h, borderRadius: radius.sm, backgroundColor: colors.surfaceSunken }} />;
  return (
    <View style={{ gap: 18 }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 16, alignItems: 'flex-start' }}>
          <View style={{ flex: 1, gap: 8 }}>
            {block('55%', 18)}
            {block(60, 16)}
            {block('90%', 12)}
          </View>
          {block(96, 44)}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  stepper: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, overflow: 'hidden' },
  stepBtn: { alignItems: 'center', justifyContent: 'center' },
  add: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, minWidth: 104, height: 46, borderWidth: 1.5, paddingHorizontal: 14 },
  product: { flexDirection: 'row', gap: 16, paddingVertical: 18, alignItems: 'flex-start' },
  divider: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 1 },
});
