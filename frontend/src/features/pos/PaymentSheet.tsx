import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { BusinessSettings, PaymentInput, PaymentMethod } from '@/api/types';
import { Button, Input, Sheet, Text, useHotkeys } from '@/components/ui';
import { QrCode } from '@/components/QrCode';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import { money, PAYMENT_LABEL, round2 } from '@/lib/format';
import { buildUpiUrl } from '@/lib/print/receipt';
import { cashNotes, defaultPaymentMethod, methodToRemember } from './posLayout';
import { usePosPrefs } from './posPrefs';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

export interface LoyaltyOption {
  available: number;
  pointValue: number;
  max: number;
  points: number;
  onChange: (points: number) => void;
}

const METHODS: { method: PaymentMethod; label: string; icon: IconName }[] = [
  { method: 'CASH', label: 'Cash', icon: 'cash-outline' },
  { method: 'UPI', label: 'UPI', icon: 'qr-code-outline' },
  { method: 'CARD', label: 'Card', icon: 'card-outline' },
  { method: 'OTHER', label: 'Other', icon: 'wallet-outline' },
  { method: 'CREDIT', label: 'Udhaar', icon: 'book-outline' },
];

export function PaymentSheet({ visible, onClose, due: liveDue, currency, settings, hasCustomer, aggregator, loyalty, submitting, onConfirm, title, offerNote }: {
  visible: boolean;
  onClose: () => void;
  /** Amount still to collect on this bill. */
  due: number;
  currency: string;
  settings: BusinessSettings | null;
  hasCustomer: boolean;
  aggregator: boolean;
  loyalty: LoyaltyOption | null;
  submitting: boolean;
  onConfirm: (payments: PaymentInput[], change: number) => void;
  title?: string;
  /** e.g. "Includes Happy hours (−₹50.00)" — the offer already in the amount due. */
  offerNote?: string | null;
}) {
  const { colors, radius } = useTheme();
  const { isPhone } = useLayout();
  const [added, setAdded] = useState<PaymentInput[]>([]);
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [amountText, setAmountText] = useState('');
  const [reference, setReference] = useState('');
  const [pointsText, setPointsText] = useState('');
  const amountRef = useRef<TextInput>(null);
  // Freeze the amount while the sheet animates closed (the cart resets underneath it)
  const [frozenDue, setFrozenDue] = useState(liveDue);
  useEffect(() => { if (visible) setFrozenDue(liveDue); }, [visible, liveDue]);
  const due = visible ? liveDue : frozenDue;

  useEffect(() => {
    if (!visible) return;
    setAdded([]);
    // Starts on the method used last (cash with the exact amount for most counters)
    setMethod(defaultPaymentMethod({ aggregator, last: usePosPrefs.getState().lastMethod }));
    setAmountText('');
    setReference('');
    setPointsText(loyalty?.points ? String(loyalty.points) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const paidSoFar = round2(added.reduce((s, p) => s + p.amount, 0));
  const remaining = Math.max(0, round2(due - paidSoFar));
  const typed = amountText.trim() ? Number(amountText.replace(/,/g, '')) : NaN;
  const amount = Number.isFinite(typed) ? round2(typed) : remaining;
  const isCash = method === 'CASH';
  const overpay = !isCash && amount > remaining + 0.001;
  const invalid = !(amount > 0) || overpay || (method === 'CREDIT' && !hasCustomer);
  const covers = amount >= remaining - 0.001;
  const change = isCash && covers ? round2(amount - remaining) : 0;

  const methods = aggregator ? [{ method: 'AGGREGATOR' as PaymentMethod, label: 'Paid online', icon: 'cloud-done-outline' as IconName }, ...METHODS] : METHODS;

  const choose = (m: PaymentMethod) => {
    setMethod(m);
    setAmountText('');
    setReference('');
    if (Platform.OS === 'web') setTimeout(() => amountRef.current?.focus(), 30);
  };

  const complete = (payments: PaymentInput[], changeDue: number) => {
    const remember = methodToRemember(payments);
    if (remember) usePosPrefs.getState().set({ lastMethod: remember });
    onConfirm(payments, changeDue);
  };

  const primary = () => {
    if (submitting) return;
    if (remaining <= 0 && added.length) { complete(added, 0); return; }
    if (invalid) return;
    const payment: PaymentInput = { method, amount, reference: reference.trim() || null };
    if (covers) {
      complete([...added, payment], change);
    } else {
      setAdded((a) => [...a, payment]);
      setAmountText('');
      setReference('');
      setMethod('CASH');
    }
  };

  const applyPoints = (text: string) => {
    if (!loyalty) return;
    setPointsText(text);
    const n = Math.floor(Number(text) || 0);
    const clamped = Math.max(0, Math.min(n, loyalty.max));
    setAdded([]);
    loyalty.onChange(clamped);
  };

  const primaryLabel = remaining <= 0 && added.length ? 'Complete bill'
    : covers ? (change > 0 ? `Complete · change ${money(change, currency)}` : `Complete · ${money(amount, currency)} ${PAYMENT_LABEL[method] ?? method}`)
    : `Add ${money(amount, currency)} ${PAYMENT_LABEL[method] ?? method} · ${money(round2(remaining - amount), currency)} left`;

  const upiId = settings?.upi_id?.trim();

  // F8 / Ctrl+Enter complete the payment from anywhere in the sheet (Enter works in the amount box)
  useHotkeys({ 'F8|Ctrl+Enter': () => primary() }, [], { enabled: visible });

  return (
    <Sheet visible={visible} onClose={submitting ? () => {} : onClose} title={title ?? 'Collect payment'} width={600} dismissable={!submitting}
      footer={
        <Button title={primaryLabel} size="lg" full icon={covers || remaining <= 0 ? 'checkmark-circle' : 'add-circle-outline'} shortcut="F8"
          variant={covers || remaining <= 0 ? 'success' : 'primary'} onPress={primary} loading={submitting}
          disabled={(invalid && !(remaining <= 0 && added.length)) || submitting} testID="pos-pay-confirm" />
      }>
      <View style={[styles.dueBox, { backgroundColor: colors.surfaceSunken, borderRadius: radius.lg }]}>
        <View style={{ flex: 1 }}>
          <Text variant="small" tone="muted">{added.length ? 'Still to collect' : 'Amount due'}</Text>
          <Text variant="moneyLarge" style={{ fontSize: isPhone ? 32 : 38, lineHeight: isPhone ? 40 : 46 }}>{money(remaining, currency)}</Text>
        </View>
        {added.length ? (
          <View style={{ alignItems: 'flex-end' }}>
            <Text variant="small" tone="muted">Bill total</Text>
            <Text variant="money">{money(due, currency)}</Text>
          </View>
        ) : null}
      </View>

      {offerNote ? (
        <View style={[styles.offerNote, { backgroundColor: colors.successSoft, borderRadius: radius.md }]}>
          <Ionicons name="pricetag" size={15} color={colors.successText} />
          <Text variant="small" tone="success" style={{ flex: 1 }} numberOfLines={2}>{offerNote}</Text>
        </View>
      ) : null}

      {added.length ? (
        <View style={{ gap: 6 }}>
          {added.map((p, i) => (
            <View key={i} style={[styles.addedRow, { borderColor: colors.border, borderRadius: radius.md }]}>
              <Ionicons name="checkmark-circle" size={18} color={colors.success} />
              <Text variant="bodyStrong" style={{ flex: 1 }}>{PAYMENT_LABEL[p.method] ?? p.method}{p.reference ? ` · ${p.reference}` : ''}</Text>
              <Text variant="money">{money(p.amount, currency)}</Text>
              <Pressable onPress={() => setAdded((a) => a.filter((_, j) => j !== i))} accessibilityRole="button" accessibilityLabel="Remove this payment" hitSlop={8}>
                <Ionicons name="close" size={18} color={colors.textMuted} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.methods} accessibilityRole="radiogroup">
        {methods.map((m) => {
          const active = m.method === method;
          const blocked = m.method === 'CREDIT' && !hasCustomer;
          return (
            <Pressable key={m.method} onPress={() => choose(m.method)} accessibilityRole="radio" accessibilityState={{ selected: active }}
              accessibilityLabel={m.label}
              style={({ hovered }: any) => [styles.method, {
                borderRadius: radius.md, borderWidth: active ? 2 : 1,
                borderColor: active ? colors.primary : hovered ? colors.borderStrong : colors.border,
                backgroundColor: active ? colors.primarySoft : colors.surface, opacity: blocked && !active ? 0.6 : 1,
              }, Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}>
              <Ionicons name={m.icon} size={22} color={active ? colors.primary : colors.textMuted} />
              <Text variant="smallStrong" color={active ? colors.primarySoftText : colors.text} numberOfLines={1}>{m.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {isCash ? (
        <View style={{ gap: 10 }}>
          <Input ref={amountRef} label="Cash received" prefix={currency} keyboardType="decimal-pad" value={amountText} onChangeText={setAmountText}
            placeholder={String(remaining)} onSubmitEditing={primary} autoFocus={Platform.OS === 'web'} style={{ fontSize: 20 }} />
          {/* Quick cash: exact, then the notes customers usually hand over */}
          <View style={styles.chips} accessibilityLabel="Cash received">
            {cashNotes(remaining).map((v, i) => {
              const active = i === 0 ? !amountText || amount === v : amount === v && !!amountText;
              return (
                <Button key={v} title={i === 0 ? `Exact ${money(v, currency, v % 1 === 0)}` : money(v, currency, true)} size="md"
                  variant={active ? 'tonal' : 'outline'} onPress={() => setAmountText(i === 0 ? '' : String(v))}
                  style={i === 0 ? styles.exact : styles.note} accessibilityLabel={i === 0 ? `Exact amount ${money(v, currency)}` : `Customer gave ${money(v, currency)}`} />
              );
            })}
          </View>
          {change > 0 ? (
            <View style={[styles.change, { backgroundColor: colors.successSoft, borderRadius: radius.md }]}>
              <Text variant="bodyStrong" tone="success">Return change</Text>
              <Text variant="moneyLarge" tone="success">{money(change, currency)}</Text>
            </View>
          ) : amount > 0 && !covers ? (
            <Text variant="small" tone="muted">Less than due — this will be added as a part payment, then pick how the rest is paid.</Text>
          ) : null}
        </View>
      ) : (
        <View style={{ gap: 10 }}>
          {method === 'UPI' ? (
            upiId ? (
              <View style={[styles.qrBox, { borderColor: colors.border, borderRadius: radius.lg }]}>
                <QrCode value={buildUpiUrl(upiId, settings?.business_name ?? 'Shop', amount > 0 ? amount : remaining)} size={isPhone ? 170 : 200} />
                <Text variant="smallStrong">Scan with any UPI app to pay {money(amount > 0 ? amount : remaining, currency)}</Text>
                <Text variant="small" tone="muted">{upiId}</Text>
              </View>
            ) : (
              <View style={[styles.hint, { backgroundColor: colors.infoSoft, borderRadius: radius.md }]}>
                <Ionicons name="information-circle" size={18} color={colors.info} />
                <Text variant="small" tone="info" style={{ flex: 1 }}>Add your UPI ID in Settings → Business to show a payment QR here with the exact amount.</Text>
              </View>
            )
          ) : null}
          {method === 'CREDIT' && !hasCustomer ? (
            <View style={[styles.hint, { backgroundColor: colors.warningSoft, borderRadius: radius.md }]}>
              <Ionicons name="person-add-outline" size={18} color={colors.warning} />
              <Text variant="small" tone="warning" style={{ flex: 1 }}>Credit needs a customer. Close this and add the customer to the bill first.</Text>
            </View>
          ) : null}
          <View style={styles.inline}>
            <Input ref={amountRef} label="Amount" prefix={currency} keyboardType="decimal-pad" value={amountText} onChangeText={setAmountText}
              placeholder={String(remaining)} containerStyle={{ flex: 1 }} onSubmitEditing={primary}
              error={overpay ? `Max ${money(remaining, currency)} — only cash can be more than the bill` : null} />
            {method !== 'CREDIT' ? (
              <Input label={method === 'AGGREGATOR' ? 'Order / txn ID' : 'Reference (optional)'} value={reference} onChangeText={setReference}
                placeholder={method === 'CARD' ? 'Last 4 digits' : method === 'UPI' ? 'UTR' : ''} containerStyle={{ flex: 1 }} maxLength={100} onSubmitEditing={primary} />
            ) : null}
          </View>
        </View>
      )}

      {loyalty && loyalty.available > 0 ? (
        <View style={[styles.loyalty, { borderColor: colors.border, borderRadius: radius.md }]}>
          <Ionicons name="star" size={18} color={colors.accent} />
          <View style={{ flex: 1 }}>
            <Text variant="smallStrong">Redeem points</Text>
            <Text variant="small" tone="muted">{loyalty.available} available · 1 pt = {money(loyalty.pointValue, currency)} · max {loyalty.max}</Text>
          </View>
          <TextInput value={pointsText} onChangeText={applyPoints} keyboardType="number-pad" placeholder="0" placeholderTextColor={colors.textSubtle}
            accessibilityLabel="Points to redeem"
            style={[styles.pointsInput, { color: colors.text, borderColor: colors.border, borderRadius: radius.sm }, Platform.OS === 'web' && ({ outlineStyle: 'none' } as any)]} />
          <Button title="Max" size="sm" variant="soft" onPress={() => applyPoints(String(loyalty.max))} disabled={!loyalty.max} />
        </View>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  dueBox: { flexDirection: 'row', alignItems: 'flex-end', padding: 16, gap: 12 },
  offerNote: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8 },
  addedRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10 },
  methods: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  method: { flexGrow: 1, flexBasis: 96, minHeight: 64, alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  note: { flexGrow: 1, flexBasis: 80 },
  exact: { flexGrow: 2, flexBasis: 150 },
  change: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10 },
  qrBox: { alignItems: 'center', gap: 6, padding: 16, borderWidth: 1 },
  hint: { flexDirection: 'row', gap: 8, padding: 12, alignItems: 'flex-start' },
  inline: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  loyalty: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, padding: 12 },
  pointsInput: { width: 72, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 6, fontSize: 15, textAlign: 'right' },
});
