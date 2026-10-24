import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Link } from 'expo-router';
import { useTheme } from '@/theme/ThemeProvider';
import { Button, Input, Segmented, Sheet, Text, VegMark } from '@/components/ui';
import { Notice } from '../PublicPage';
import { normaliseIndianMobile, pickPayment, tableName, type CartLine, type CustomerDetails, type OrderMode, price } from './model';
import type { PaymentChoice } from './api';
import { Stepper } from './parts';

export interface CheckoutInput extends CustomerDetails { phoneDigits: string; notes: string; payment: PaymentChoice }

const PAYMENT_TEXT: Record<PaymentChoice, { title: string; body: string; icon: keyof typeof Ionicons.glyphMap }> = {
  counter: { title: 'Pay at the counter / to the waiter', body: 'Cash, card or UPI when you’re done.', icon: 'cash-outline' },
  upi: { title: 'Pay now by UPI', body: 'GPay, PhonePe, Paytm or any UPI app — right after you order.', icon: 'phone-portrait-outline' },
};

const ONLY_COUNTER: PaymentChoice[] = ['counter'];

export function CartSheet({
  visible, onClose, lines, symbol, pricesIncludeTax, businessName, mode, tableLabel, initialDetails,
  onChangeQty, onChangeNotes, onClear, onPlace, payments = ONLY_COUNTER, defaultPayment, existingBill,
}: {
  visible: boolean; onClose: () => void; lines: CartLine[]; symbol: string; pricesIncludeTax: boolean; businessName: string;
  mode: OrderMode; tableLabel: string | null; initialDetails: CustomerDetails | null;
  /** Table QR: the payment options the shop allows, and the customer's previous choice */
  payments?: PaymentChoice[]; defaultPayment?: PaymentChoice | null;
  /** Table QR: the open bill this order will be added to (when the same phone number is used) */
  existingBill?: { code: string; phone: string | null } | null;
  onChangeQty: (key: string, qty: number) => void; onChangeNotes: (key: string, notes: string) => void; onClear: () => void;
  /** Resolves to an error message, or null on success. */
  onPlace: (input: CheckoutInput) => Promise<string | null>;
}) {
  const { colors, radius } = useTheme();
  const [step, setStep] = useState<'cart' | 'details'>('cart');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [orderType, setOrderType] = useState<'TAKEAWAY' | 'DELIVERY'>('TAKEAWAY');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [payment, setPayment] = useState<PaymentChoice>(() => pickPayment(payments, defaultPayment));
  const [errors, setErrors] = useState<{ name?: string; phone?: string; address?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);
  const [noteOpen, setNoteOpen] = useState<Record<string, boolean>>({});
  const phoneRef = useRef<TextInput>(null);

  useEffect(() => {
    if (!visible) return;
    setStep('cart');
    setFormError(null);
    setErrors({});
    if (initialDetails) {
      setName((v) => v || initialDetails.name);
      setPhone((v) => v || initialDetails.phone);
      setAddress((v) => v || initialDetails.address);
      setOrderType(initialDetails.orderType);
    }
    setPayment((p) => pickPayment(payments, defaultPayment ?? p));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => {
    if (visible && lines.length === 0) onClose();
  }, [visible, lines.length, onClose]);

  const count = lines.reduce((n, l) => n + l.qty, 0);
  const subtotal = lines.reduce((n, l) => n + l.price * l.qty, 0);
  const phoneDigits = normaliseIndianMobile(phone);
  const addingToBill = mode === 'QR' && !!existingBill && (!existingBill.phone || !phoneDigits || existingBill.phone === phoneDigits);
  const taxNote = pricesIncludeTax ? 'Prices include GST' : 'GST will be added as applicable';

  const validate = () => {
    const next: typeof errors = {};
    if (!name.trim()) next.name = 'Please enter your name.';
    else if (name.trim().length > 80) next.name = 'Name is too long.';
    if (!phone.trim()) next.phone = 'Please enter your mobile number.';
    else if (!normaliseIndianMobile(phone)) next.phone = 'Enter a valid 10-digit Indian mobile number.';
    if (mode === 'ONLINE' && orderType === 'DELIVERY' && address.trim().length < 10) next.address = 'Please enter your full delivery address.';
    setErrors(next);
    return !next.name && !next.phone && !next.address;
  };

  const place = async () => {
    setFormError(null);
    if (!validate()) return;
    setPlacing(true);
    try {
      const err = await onPlace({
        name: name.trim(), phone: phone.trim(), phoneDigits: normaliseIndianMobile(phone)!, orderType,
        address: address.trim(), notes: notes.trim(), payment: pickPayment(payments, payment),
      });
      if (err) setFormError(err);
    } finally {
      setPlacing(false);
    }
  };

  const footer = step === 'cart' ? (
    <Button title={`Continue · ${price(subtotal, symbol)}`} size="lg" full onPress={() => setStep('details')} iconRight="arrow-forward" disabled={!lines.length} />
  ) : (
    <View style={{ gap: 10 }}>
      {formError ? <Notice tone="danger">{formError}</Notice> : null}
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Button title="Back" variant="secondary" size="lg" icon="arrow-back" onPress={() => setStep('cart')} disabled={placing} />
        <Button title={`${addingToBill ? 'Add to my bill' : 'Place order'} · ${price(subtotal, symbol)}`} size="lg" onPress={place} loading={placing} style={{ flex: 1 }} />
      </View>
      {!pricesIncludeTax ? <Text variant="caption" tone="subtle" align="center">+ GST as applicable. The final amount is on your bill.</Text> : null}
    </View>
  );

  return (
    <Sheet visible={visible} onClose={placing ? () => {} : onClose} dismissable={!placing} width={520}
      title={step === 'cart' ? 'Your order' : 'Your details'}
      subtitle={step === 'cart' ? `${count} item${count === 1 ? '' : 's'}${mode === 'QR' ? ` · ${tableName(tableLabel)}` : ''}` : businessName}
      footer={footer}>
      {step === 'cart' ? (
        <View style={{ gap: 4 }}>
          {lines.map((line) => (
            <View key={line.key} style={[styles.line, { borderBottomColor: colors.divider }]}>
              <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <VegMark veg={line.isVeg} size={12} />
                    <Text variant="bodyStrong" style={{ flexShrink: 1 }} numberOfLines={2}>{line.name}</Text>
                  </View>
                  <Text variant="small" tone="muted">
                    {line.variantName ? `${line.variantName} · ` : ''}{price(line.price, symbol)}
                  </Text>
                </View>
                <Stepper compact value={line.qty} onChange={(q) => onChangeQty(line.key, q)} label={line.name} />
                <Text variant="money" style={{ minWidth: 72, textAlign: 'right' }}>{price(line.price * line.qty, symbol)}</Text>
              </View>
              {noteOpen[line.key] || line.notes ? (
                <Input value={line.notes} onChangeText={(v) => onChangeNotes(line.key, v.slice(0, 200))} placeholder="e.g. less spicy, no onion"
                  maxLength={200} accessibilityLabel={`Note for ${line.name}`} containerStyle={{ marginTop: 8 }} icon="create-outline" />
              ) : (
                <Pressable onPress={() => setNoteOpen((o) => ({ ...o, [line.key]: true }))} accessibilityRole="button"
                  accessibilityLabel={`Add a note for ${line.name}`} style={[styles.noteBtn, Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}>
                  <Ionicons name="add-circle-outline" size={16} color={colors.primary} />
                  <Text variant="smallStrong" tone="primary">Add note</Text>
                </Pressable>
              )}
            </View>
          ))}
          <View style={[styles.totals, { backgroundColor: colors.surfaceSunken, borderRadius: radius.md }]}>
            <View style={styles.totalRow}>
              <Text variant="bodyStrong">Item total</Text>
              <Text variant="money">{price(subtotal, symbol)}</Text>
            </View>
            <Text variant="small" tone="muted">{taxNote}</Text>
          </View>
          <Pressable onPress={onClear} accessibilityRole="button" style={[styles.clear, Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}>
            <Ionicons name="trash-outline" size={16} color={colors.textMuted} />
            <Text variant="smallStrong" tone="muted">Clear cart</Text>
          </Pressable>
        </View>
      ) : (
        <View style={{ gap: 14 }}>
          {mode === 'QR' ? (
            <View style={[styles.tableBox, { backgroundColor: colors.primarySoft, borderRadius: radius.md }]}>
              <Ionicons name="restaurant-outline" size={20} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text variant="bodyStrong" color={colors.primarySoftText}>Dine-in · {tableName(tableLabel)}</Text>
                <Text variant="small" color={colors.primarySoftText}>
                  {addingToBill && existingBill ? `This will be added to your bill #${existingBill.code}.` : "We'll bring your order to your table."}
                </Text>
              </View>
            </View>
          ) : (
            <View style={{ gap: 6 }}>
              <Text variant="smallStrong" tone="muted">How would you like it?</Text>
              <Segmented value={orderType} onChange={setOrderType}
                options={[{ value: 'TAKEAWAY', label: 'Takeaway', icon: 'bag-handle-outline' }, { value: 'DELIVERY', label: 'Delivery', icon: 'bicycle-outline' }]} />
            </View>
          )}
          <Input label="Your name" required value={name} onChangeText={(v) => { setName(v); setErrors((e) => ({ ...e, name: undefined })); }}
            error={errors.name} autoComplete="name" textContentType="name" maxLength={80} returnKeyType="next"
            onSubmitEditing={() => phoneRef.current?.focus()} icon="person-outline" />
          <Input ref={phoneRef} label="Mobile number" required value={phone} prefix="+91"
            onChangeText={(v) => { setPhone(v.replace(/[^\d+\s-]/g, '')); setErrors((e) => ({ ...e, phone: undefined })); }}
            onBlur={() => { if (phone.trim() && !normaliseIndianMobile(phone)) setErrors((e) => ({ ...e, phone: 'Enter a valid 10-digit Indian mobile number.' })); }}
            error={errors.phone}
            hint={mode !== 'QR'
              ? 'The shop may call you about this order.'
              : existingBill && !addingToBill
                ? `A different number starts a separate bill. Use the same number to add to bill #${existingBill.code}.`
                : 'Keeps your bill separate from others at the table.'}
            keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber"
            maxLength={16} placeholder="98765 43210" />
          {mode === 'ONLINE' && orderType === 'DELIVERY' ? (
            <Input label="Delivery address" required value={address} onChangeText={(v) => { setAddress(v); setErrors((e) => ({ ...e, address: undefined })); }}
              error={errors.address} multiline numberOfLines={3} maxLength={500} autoComplete="street-address" textContentType="fullStreetAddress"
              placeholder="House / flat, street, area, landmark, PIN code" style={{ minHeight: 76, textAlignVertical: 'top' }} />
          ) : null}
          {mode === 'QR' && !addingToBill ? (
            <View style={{ gap: 8 }} accessibilityRole="radiogroup" accessibilityLabel="How will you pay?">
              <Text variant="smallStrong" tone="muted">How will you pay?</Text>
              {payments.map((p) => {
                const selected = pickPayment(payments, payment) === p;
                const t = PAYMENT_TEXT[p];
                const single = payments.length === 1;
                return (
                  <Pressable key={p} onPress={() => setPayment(p)} accessibilityRole="radio" accessibilityState={{ checked: selected }}
                    accessibilityLabel={t.title} disabled={single}
                    style={[styles.payOption, {
                      borderRadius: radius.md, borderColor: selected ? colors.primary : colors.border,
                      backgroundColor: selected ? colors.primarySoft : colors.surface,
                    }, Platform.OS === 'web' && !single && ({ cursor: 'pointer' } as any)]}>
                    <Ionicons name={t.icon} size={22} color={selected ? colors.primary : colors.textMuted} />
                    <View style={{ flex: 1 }}>
                      <Text variant="bodyStrong" color={selected ? colors.primarySoftText : colors.text}>{t.title}</Text>
                      <Text variant="small" tone="muted">{t.body}</Text>
                    </View>
                    {!single ? (
                      <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={22} color={selected ? colors.primary : colors.borderStrong} />
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          ) : null}
          <Input label={mode === 'QR' ? 'Notes for the kitchen' : 'Notes for the shop'} value={notes} onChangeText={setNotes} maxLength={300}
            placeholder={mode === 'QR' ? 'Optional — e.g. allergies, less spicy' : 'Optional — e.g. allergies, pickup time'}
            multiline style={{ minHeight: 56, textAlignVertical: 'top' }} />
          <View style={styles.consent}>
            <Ionicons name="shield-checkmark-outline" size={16} color={colors.textSubtle} style={{ marginTop: 1 }} />
            <Text variant="small" tone="muted" style={{ flex: 1 }}>
              Your name and number are shared with {businessName} to fulfil this order.{' '}
              <Link href="/privacy" accessibilityRole="link"><Text variant="smallStrong" tone="primary">Privacy policy</Text></Link>
            </Text>
          </View>
        </View>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  line: { paddingVertical: 14, borderBottomWidth: 1 },
  noteBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', minHeight: 32, marginTop: 4 },
  totals: { padding: 14, gap: 4, marginTop: 12 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  clear: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center', minHeight: 44, paddingHorizontal: 12, marginTop: 4 },
  tableBox: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  consent: { flexDirection: 'row', gap: 8 },
  payOption: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, minHeight: 64, borderWidth: 1.5 },
});
