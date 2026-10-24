/**
 * Live view of a table-QR bill: waiting for the staff → in the kitchen (per-item status) → paid.
 * Polls every 10 s while the bill is open (and the tab is visible), and handles paying: at the counter, or by UPI
 * (deep link on phones, QR code on desktop) followed by "I've paid", which staff confirm in their app.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme/ThemeProvider';
import { Badge, Button, Card, Input, Text, toast } from '@/components/ui';
import { QrCode } from '@/components/QrCode';
import { ApiError, errorMessage } from '@/api/client';
import { formatTime } from '@/lib/format';
import { Notice } from '../PublicPage';
import { storeApi, type PaymentChoice, type PublicOrder } from './api';
import {
  allowedPayments, balanceDue, billRoundOff, canOpenUpiApp, cleanUtr, itemStatus, paymentState, pickPayment, price, tableName, tableStage, utrError,
  type PlacedOrder, type TableStage,
} from './model';

const POLL_MS = 10_000;
type IconName = keyof typeof Ionicons.glyphMap;

const STAGE_TEXT: Record<TableStage, { title: string; icon: IconName }> = {
  waiting: { title: 'Waiting for the restaurant to confirm', icon: 'hourglass-outline' },
  kitchen: { title: 'In the kitchen', icon: 'flame-outline' },
  served: { title: 'Enjoy your meal!', icon: 'restaurant-outline' },
  done: { title: 'Paid — thank you!', icon: 'checkmark-done' },
  cancelled: { title: 'Order cancelled', icon: 'close' },
};

const PROGRESS: { key: TableStage; label: string }[] = [
  { key: 'waiting', label: 'Sent' },
  { key: 'kitchen', label: 'In kitchen' },
  { key: 'served', label: 'Served' },
];

function isHidden(): boolean {
  return Platform.OS === 'web' && typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

export function TableOrderTracker({ tenantId, order, symbol, businessName, phone, onOrderMore, onChange, onMissing }: {
  tenantId: string; order: PlacedOrder; symbol: string; businessName: string; phone: string | null;
  onOrderMore: () => void;
  /** Keeps the remembered order (status, total, payment choice) in step with the server */
  onChange: (patch: Partial<PlacedOrder>) => void;
  onMissing: () => void;
}) {
  const { colors, radius } = useTheme();
  const [data, setData] = useState<PublicOrder | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [failing, setFailing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [choice, setChoice] = useState<PaymentChoice>(order.payment ?? 'counter');
  const [claimOpen, setClaimOpen] = useState(false);
  const [utr, setUtr] = useState('');
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const mounted = useRef(true);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onMissingRef = useRef(onMissing);
  onMissingRef.current = onMissing;

  const apply = useCallback((o: PublicOrder) => {
    setData(o);
    setUpdatedAt(new Date());
    setFailing(false);
    onChangeRef.current({ status: o.status, total_amount: o.total_amount, code: o.code, paid: paymentState(o) === 'paid' });
  }, []);

  const load = useCallback(async () => {
    setChecking(true);
    try {
      const o = await storeApi.order(tenantId, order.id);
      if (mounted.current) apply(o);
    } catch (e) {
      if (!mounted.current) return;
      if (e instanceof ApiError && e.status === 404) onMissingRef.current();
      setFailing(true);
    } finally {
      if (mounted.current) setChecking(false);
    }
  }, [tenantId, order.id, apply]);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => { mounted.current = false; };
  }, [load]);

  const status = data?.status ?? order.status;
  const final = status === 'completed' || status === 'cancelled';

  useEffect(() => {
    if (final) return undefined;
    const id = setInterval(() => { if (!isHidden()) void load(); }, POLL_MS);
    // Catch up straight away when the customer comes back to the tab (e.g. from their UPI app)
    const onVisible = () => { if (!isHidden()) void load(); };
    if (Platform.OS === 'web' && typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      if (Platform.OS === 'web' && typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
    };
  }, [final, load]);

  const stage = tableStage({ status, items: data?.items ?? [] });
  const pay = data ? paymentState(data) : order.paid ? 'paid' : 'due';
  const allowed = allowedPayments(data?.payment_options);
  const method = pickPayment(allowed, choice);
  const due = data ? balanceDue(data) : order.total_amount;
  const total = data?.total_amount ?? order.total_amount;
  const code = data?.code ?? order.code;
  const roundOff = data ? billRoundOff(data) : 0;
  const where = tableName(order.tableLabel);
  const upiId = data?.payment_options?.upi_id ?? null;
  const mobile = canOpenUpiApp(Platform.OS,
    typeof navigator !== 'undefined' ? navigator.userAgent : '', typeof navigator !== 'undefined' ? navigator.maxTouchPoints ?? 0 : 0);

  const choose = (c: PaymentChoice) => {
    setChoice(c);
    setClaimOpen(false);
    onChange({ payment: c });
  };

  const openUpi = async () => {
    if (!data?.upi_link) return;
    try {
      await Linking.openURL(data.upi_link);
      setClaimOpen(true);
    } catch {
      toast.warning(upiId ? `Couldn't open a UPI app. Pay ${price(due, symbol)} to ${upiId}.` : "Couldn't open a UPI app.");
      setClaimOpen(true);
    }
  };

  const claim = async () => {
    const err = utrError(utr);
    if (err) { setClaimError(err); return; }
    setClaimError(null);
    setClaiming(true);
    try {
      const o = await storeApi.claimPayment(tenantId, order.id, cleanUtr(utr) || null);
      if (!mounted.current) return;
      apply(o);
      setClaimOpen(false);
      toast.success('Thanks! The staff will confirm your payment.');
    } catch (e) {
      if (!mounted.current) return;
      if (e instanceof ApiError && e.status === 409) {
        setClaimError(e.message);
        void load();
      } else if (e instanceof ApiError && e.status === 429) setClaimError('Please wait a minute and try again.');
      else setClaimError(errorMessage(e));
    } finally {
      if (mounted.current) setClaiming(false);
    }
  };

  const heroTone = stage === 'cancelled' ? [colors.dangerSoft, colors.danger]
    : stage === 'done' ? [colors.successSoft, colors.success]
      : stage === 'waiting' ? [colors.warningSoft, colors.warningText] : [colors.primarySoft, colors.primary];

  const subtitle = stage === 'cancelled'
    ? `${businessName} couldn't take this order. Please ask the staff — if you already paid, they'll sort it out.`
    : stage === 'waiting'
      ? 'The staff will check your order in a moment. It goes to the kitchen right after.'
      : stage === 'kitchen'
        ? `Your food is being prepared. We'll bring it to ${where}.`
        : stage === 'served'
          ? 'Everything has been served. Want something else? Tap “Order more”.'
          : `Thanks for dining at ${businessName}.`;

  const progressIndex = stage === 'waiting' ? 0 : stage === 'kitchen' ? 1 : 2;

  return (
    <View style={{ gap: 16 }}>
      {/* Status */}
      <Card elevated style={{ alignItems: 'center', gap: 10, paddingVertical: 24 }}>
        <View style={[styles.heroIcon, { backgroundColor: heroTone[0] }]}>
          <Ionicons name={STAGE_TEXT[stage].icon} size={30} color={heroTone[1]} />
        </View>
        <Text variant="h1" align="center" accessibilityRole="header" accessibilityLiveRegion="polite">{STAGE_TEXT[stage].title}</Text>
        <Text tone="muted" align="center" style={{ maxWidth: 420 }}>{subtitle}</Text>
        <View style={[styles.codeBox, { backgroundColor: colors.surfaceSunken, borderRadius: radius.lg }]}>
          <View style={{ alignItems: 'center' }}>
            <Text variant="caption" tone="subtle" style={styles.upper}>Bill</Text>
            <Text variant="h2" selectable accessibilityLabel={`Bill number ${code}`}>#{code}</Text>
          </View>
          <View style={[styles.vr, { backgroundColor: colors.border }]} />
          <View style={{ alignItems: 'center' }}>
            <Text variant="caption" tone="subtle" style={styles.upper}>Table</Text>
            <Text variant="h2">{(order.tableLabel ?? '').replace(/^table\s*/i, '') || '—'}</Text>
          </View>
        </View>
        {data?.bill_label ? <Text variant="small" tone="subtle">Bill for {data.bill_label}</Text> : null}
        {stage !== 'cancelled' && stage !== 'done' ? (
          <View style={styles.progress} accessibilityLabel={`Progress: ${PROGRESS[progressIndex].label}`}>
            {PROGRESS.map((p, i) => {
              const done = i <= progressIndex;
              return (
                <View key={p.key} style={{ flex: 1, gap: 6 }}>
                  <View style={[styles.bar, { backgroundColor: done ? colors.primary : colors.border }]} />
                  <Text variant="caption" tone={done ? 'primary' : 'subtle'} align="center">{p.label}</Text>
                </View>
              );
            })}
          </View>
        ) : null}
      </Card>

      {/* Payment */}
      {stage !== 'cancelled' && data && pay !== 'nothing' ? (
        <Card style={{ gap: 12 }}>
          {pay === 'paid' ? (
            <View style={styles.payRow}>
              <View style={[styles.payIcon, { backgroundColor: colors.successSoft }]}>
                <Ionicons name="checkmark" size={22} color={colors.success} />
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="h3" tone="success">Paid ✓</Text>
                <Text variant="small" tone="muted">{price(total, symbol)} received. Thank you!</Text>
              </View>
            </View>
          ) : pay === 'claimed' ? (
            <View style={styles.payRow}>
              <View style={[styles.payIcon, { backgroundColor: colors.warningSoft }]}>
                <ActivityIndicator color={colors.warningText} />
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="h3">Payment being confirmed…</Text>
                <Text variant="small" tone="muted">
                  You paid {price(data.payment_claim?.amount ?? due, symbol)} by UPI{data.payment_claim?.reference ? ` (ref ${data.payment_claim.reference})` : ''}.
                  {' '}The staff are checking it in their UPI app.
                </Text>
              </View>
            </View>
          ) : method === 'upi' && data.upi_link ? (
            <View style={{ gap: 12 }}>
              <View>
                <Text variant="h3">Pay {price(due, symbol)} by UPI</Text>
                <Text variant="small" tone="muted">
                  To {data.payment_options?.payee_name || businessName}{upiId ? ` · ${upiId}` : ''}. GPay, PhonePe, Paytm or any UPI app.
                </Text>
              </View>
              {mobile ? (
                <Button title={`Pay ${price(due, symbol)} by UPI`} size="lg" full icon="phone-portrait-outline" onPress={openUpi} />
              ) : (
                <View style={{ alignItems: 'center', gap: 8 }}>
                  <View style={[styles.qrFrame, { borderColor: colors.border, borderRadius: radius.lg }]}>
                    <QrCode value={data.upi_link} size={200} margin={3} />
                  </View>
                  <Text variant="small" tone="muted" align="center">Scan with any UPI app on your phone to pay {price(due, symbol)}.</Text>
                </View>
              )}
              {claimOpen ? (
                <View style={{ gap: 10 }}>
                  <Input label="UPI reference / UTR (optional)" value={utr} onChangeText={(v) => { setUtr(cleanUtr(v)); setClaimError(null); }}
                    placeholder="12-digit number from your UPI app" keyboardType="default" autoCapitalize="characters" maxLength={40}
                    hint="Helps the staff find your payment faster." icon="receipt-outline" />
                  {claimError ? <Notice tone="danger">{claimError}</Notice> : null}
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <Button title="Cancel" variant="secondary" onPress={() => setClaimOpen(false)} disabled={claiming} />
                    <Button title="Confirm I've paid" icon="checkmark" onPress={claim} loading={claiming} style={{ flex: 1 }} />
                  </View>
                </View>
              ) : (
                <Button title="I've paid" variant="secondary" size="lg" full icon="checkmark-circle-outline" onPress={() => setClaimOpen(true)} />
              )}
              {allowed.includes('counter') ? (
                <LinkButton label="Pay at the counter instead" onPress={() => choose('counter')} />
              ) : null}
            </View>
          ) : (
            <View style={{ gap: 10 }}>
              <View style={styles.payRow}>
                <View style={[styles.payIcon, { backgroundColor: colors.primarySoft }]}>
                  <Ionicons name="cash-outline" size={22} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text variant="h3">Please pay at the counter</Text>
                  <Text variant="small" tone="muted">Show bill #{code} to the cashier, or ask your waiter for the bill. {price(due, symbol)} to pay.</Text>
                </View>
              </View>
              {allowed.includes('upi') && data.upi_link ? <LinkButton label="Pay now by UPI instead" onPress={() => choose('upi')} /> : null}
            </View>
          )}
        </Card>
      ) : null}

      {/* Items */}
      <Card style={{ gap: 4 }}>
        <Text variant="h3" style={{ marginBottom: 6 }}>Your items</Text>
        {(data?.items ?? []).map((item, i) => {
          const s = itemStatus(item.status, status);
          return (
            <View key={i} style={[styles.itemRow, { borderBottomColor: colors.divider }]}>
              <Text tone="muted" style={styles.qty}>{item.quantity}×</Text>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={2}>{item.name}{item.variant_name ? <Text tone="muted"> · {item.variant_name}</Text> : null}</Text>
                {typeof item.line_total === 'number' ? <Text variant="small" tone="subtle">{price(item.line_total, symbol)}</Text> : null}
              </View>
              {stage !== 'cancelled' && stage !== 'done' ? <Badge label={s.label} tone={s.tone} /> : null}
            </View>
          );
        })}
        {!data ? <Text tone="subtle" variant="small">{failing ? "Couldn't load your items yet." : 'Loading your items…'}</Text> : null}
        {data ? (
          <View style={{ gap: 6, paddingTop: 10 }}>
            {data.subtotal !== undefined && (data.tax_amount || data.discount_amount || Math.abs(roundOff) >= 0.005) ? (
              <>
                <Row label="Item total" value={price(data.subtotal, symbol)} />
                {data.discount_amount ? <Row label="Discount" value={`− ${price(data.discount_amount, symbol)}`} /> : null}
                {data.tax_amount ? <Row label="GST" value={price(data.tax_amount, symbol)} /> : null}
                {Math.abs(roundOff) >= 0.005 ? <Row label="Round off" value={`${roundOff < 0 ? '− ' : ''}${price(Math.abs(roundOff), symbol)}`} /> : null}
              </>
            ) : null}
            <Row label="Bill total" value={price(total, symbol)} strong />
            {pay !== 'paid' && due > 0 && Math.abs(due - total) > 0.005 ? <Row label="Paid so far" value={price(total - due, symbol)} /> : null}
            {pay !== 'paid' && due > 0 ? <Row label="Balance to pay" value={price(due, symbol)} strong /> : null}
          </View>
        ) : null}
      </Card>

      <View style={styles.meta}>
        <Ionicons name={failing ? 'cloud-offline-outline' : 'sync-outline'} size={14} color={failing ? colors.warningText : colors.textSubtle} />
        <Text variant="small" tone={failing ? 'warning' : 'subtle'}>
          {failing ? "Can't reach the restaurant right now — we'll keep trying."
            : final ? `Last updated ${updatedAt ? formatTime(updatedAt.toISOString()) : ''}`
              : `Updates every few seconds${updatedAt ? ` · checked ${formatTime(updatedAt.toISOString())}` : ''}`}
        </Text>
      </View>

      <View style={styles.actions}>
        <Button title={final ? 'Start a new order' : 'Order more'} icon="add-circle-outline" size="lg" onPress={onOrderMore} style={{ flexGrow: 1 }} />
        {!final ? <Button title="Refresh" variant="secondary" size="lg" icon="refresh" onPress={() => void load()} loading={checking} /> : null}
        {phone ? (
          <Button title="Call" variant="secondary" size="lg" icon="call-outline" accessibilityLabel={`Call ${businessName}`}
            onPress={() => void Linking.openURL(`tel:${phone.replace(/\s/g, '')}`).catch(() => {})} />
        ) : null}
      </View>
    </View>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.totalRow}>
      <Text variant={strong ? 'bodyStrong' : 'body'} tone={strong ? 'default' : 'muted'}>{label}</Text>
      <Text variant={strong ? 'money' : 'body'} tone={strong ? 'default' : 'muted'}>{value}</Text>
    </View>
  );
}

function LinkButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" hitSlop={6}
      style={[styles.link, Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}>
      <Text variant="smallStrong" tone="primary">{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  heroIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  codeBox: { flexDirection: 'row', gap: 24, alignItems: 'center', justifyContent: 'center', paddingVertical: 12, paddingHorizontal: 24, marginTop: 6 },
  vr: { width: 1, alignSelf: 'stretch' },
  upper: { textTransform: 'uppercase' },
  progress: { flexDirection: 'row', gap: 8, alignSelf: 'stretch', marginTop: 8, paddingHorizontal: 4 },
  bar: { height: 6, borderRadius: 3 },
  payRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  payIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  qrFrame: { padding: 10, borderWidth: 1 },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  qty: { minWidth: 28, fontVariant: ['tabular-nums'] },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center' },
  actions: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  link: { alignSelf: 'center', minHeight: 44, justifyContent: 'center', paddingHorizontal: 12 },
});
