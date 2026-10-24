import React, { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { Button, Sheet, Text, VegMark } from '@/components/ui';
import { price, type MenuProduct } from './model';
import { Stepper } from './parts';

/** Pick a size/option for an item that has variants, then add it to the cart. */
export function VariantSheet({ visible, product, symbol, onClose, onAdd }: {
  visible: boolean; product: MenuProduct | null; symbol: string; onClose: () => void; onAdd: (variantId: string, qty: number) => void;
}) {
  const { colors, radius } = useTheme();
  const [variantId, setVariantId] = useState<string | null>(null);
  const [qty, setQty] = useState(1);

  useEffect(() => {
    if (product && visible) {
      setVariantId(product.variants[0]?.id ?? null);
      setQty(1);
    }
  }, [product, visible]);

  const variant = product?.variants.find((v) => v.id === variantId) ?? null;

  return (
    <Sheet visible={visible && !!product} onClose={onClose} title={product?.name ?? ''} subtitle="Choose an option" width={480}
      footer={
        <View style={styles.footer}>
          <Stepper value={qty} onChange={setQty} min={1} label={product?.name ?? 'item'} />
          <Button title={variant ? `Add · ${price(variant.price * qty, symbol)}` : 'Add'} onPress={() => variant && onAdd(variant.id, qty)}
            disabled={!variant} style={{ flex: 1 }} size="lg" />
        </View>
      }>
      {product ? (
        <View style={{ gap: 10 }} accessibilityRole="radiogroup">
          {product.description ? <Text tone="muted">{product.description}</Text> : null}
          {product.variants.map((v) => {
            const selected = v.id === variantId;
            return (
              <Pressable key={v.id} onPress={() => setVariantId(v.id)} accessibilityRole="radio" accessibilityState={{ checked: selected }}
                accessibilityLabel={`${v.name}, ${price(v.price, symbol)}`}
                style={({ hovered }: any) => [styles.option, {
                  borderRadius: radius.md,
                  borderColor: selected ? colors.primary : colors.border,
                  backgroundColor: selected ? colors.primarySoft : hovered ? colors.surfaceAlt : colors.surface,
                }, Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}>
                <View style={[styles.radio, { borderColor: selected ? colors.primary : colors.borderStrong }]}>
                  {selected ? <View style={[styles.radioDot, { backgroundColor: colors.primary }]} /> : null}
                </View>
                <VegMark veg={product.is_veg} size={12} />
                <Text variant="bodyStrong" style={{ flex: 1 }}>{v.name}</Text>
                <Text variant="money">{price(v.price, symbol)}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  footer: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingHorizontal: 14, borderWidth: 1.5 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
});
