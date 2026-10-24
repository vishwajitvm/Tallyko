/**
 * Renewal flow shared by the lock screen and Settings → Plan & billing:
 * pick a plan and duration → apply an offer (live quote) → pay by UPI / bank → "I've paid" with the UTR.
 * Tallyko checks the payment and switches the business on; the screens re-check GET /subscription until then.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ApiError, errorMessage } from '@/api/client';
import {
  subscriptionApi,
  type PaymentDetails,
  type PaymentMethod,
  type PaymentRequest,
  type Quote,
  type SubscriptionInfo,
  type SubscriptionOffer,
  type SubscriptionPeriod,
  type SubscriptionPlan,
} from '@/api/subscription';
import { Badge, Button, Card, IconButton, Input, Text, toast } from '@/components/ui';
import { QrCode } from '@/components/QrCode';
import { ChoiceChips, Callout, FieldRow, Hairline, copyText, monoFont } from '@/features/settings/components';
import { formatDate, money } from '@/lib/format';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import { KIND_LABEL, METHOD_LABEL, REQUEST_STATUS, featureLabel, limitsText, monthsText, upiLink } from './format';

// ---------------------------------------------------------------------------
// Selection + live quote
// ---------------------------------------------------------------------------

function defaultMonths(plan: SubscriptionPlan | undefined): number {
  if (!plan?.options.length) return 1;
  return plan.options.find((o) => o.months === 12)?.months ?? [...plan.options].sort((a, b) => b.saving - a.saving)[0]!.months;
}

function useQuote(planKey: string | null, months: number, code: string) {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  useEffect(() => {
    if (!planKey) return undefined;
    const id = ++seq.current;
    setLoading(true);
    const timer = setTimeout(() => {
      subscriptionApi
        .quote({ plan_key: planKey, months, offer_code: code || null })
        .then((q) => { if (id === seq.current) { setQuote(q); setError(null); } })
        .catch((e) => { if (id === seq.current) setError(errorMessage(e)); })
        .finally(() => { if (id === seq.current) setLoading(false); });
    }, code ? 350 : 120);
    return () => clearTimeout(timer);
  }, [planKey, months, code]);
  return { quote, loading, error };
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function StepTitle({ n, title, hint }: { n: number; title: string; hint?: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <View style={[styles.step, { backgroundColor: colors.primarySoft }]}>
        <Text variant="smallStrong" color={colors.primarySoftText}>{n}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="h3" accessibilityRole="header">{title}</Text>
        {hint ? <Text variant="small" tone="muted">{hint}</Text> : null}
      </View>
    </View>
  );
}

function PlanCard({ plan, selected, current, onPress }: { plan: SubscriptionPlan; selected: boolean; current: boolean; onPress: () => void }) {
  const { colors, radius } = useTheme();
  const shown = plan.features.slice(0, 5);
  const more = plan.features.length - shown.length;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={`${plan.name} plan, ${money(plan.price_monthly, '₹', true)} a month`}
      style={({ hovered }: any) => [
        styles.planCard,
        {
          borderRadius: radius.lg,
          borderColor: selected ? colors.primary : hovered ? colors.borderStrong : colors.border,
          backgroundColor: selected ? colors.primarySoft : colors.surface,
        },
        Platform.OS === 'web' && ({ cursor: 'pointer' } as any),
      ]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={20} color={selected ? colors.primary : colors.textSubtle} />
        <Text variant="h3" style={{ flex: 1 }} numberOfLines={1}>{plan.name}</Text>
        {current ? <Badge label="Your plan" tone="primary" /> : null}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
        <Text variant="moneyLarge">{money(plan.price_monthly, '₹', true)}</Text>
        <Text variant="small" tone="muted">/ month</Text>
      </View>
      {plan.description ? <Text variant="small" tone="muted">{plan.description}</Text> : null}
      <Text variant="smallStrong">{limitsText(plan.limits)}</Text>
      <View style={{ gap: 4 }}>
        {shown.map((f) => (
          <View key={f} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Ionicons name="checkmark" size={14} color={colors.success} />
            <Text variant="small" numberOfLines={1}>{featureLabel(f)}</Text>
          </View>
        ))}
        {more > 0 ? <Text variant="small" tone="subtle">+ {more} more</Text> : null}
      </View>
    </Pressable>
  );
}

function DurationTile({ label, price, perMonth, saving, months, selected, onPress }: {
  label: string; price: number; perMonth: number; saving: number; months: number; selected: boolean; onPress: () => void;
}) {
  const { colors, radius } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={`${label}, ${money(price, '₹', true)}${saving ? `, save ${money(saving, '₹', true)}` : ''}`}
      style={({ hovered }: any) => [
        styles.duration,
        {
          borderRadius: radius.md,
          borderColor: selected ? colors.primary : hovered ? colors.borderStrong : colors.border,
          backgroundColor: selected ? colors.primarySoft : colors.surface,
        },
        Platform.OS === 'web' && ({ cursor: 'pointer' } as any),
      ]}
    >
      <Text variant="smallStrong" color={selected ? colors.primarySoftText : colors.text} numberOfLines={1}>{label}</Text>
      <Text variant="money">{money(price, '₹', true)}</Text>
      <Text variant="caption" tone="muted">{months > 1 ? `${money(perMonth, '₹', true)}/month · ${monthsText(months)}` : '1 month'}</Text>
      {saving > 0 ? <Badge label={`Save ${money(saving, '₹', true)}`} tone="success" style={{ marginTop: 2 }} /> : null}
    </Pressable>
  );
}

function OfferRow({ offer, active, onApply }: { offer: SubscriptionOffer; active: boolean; onApply: () => void }) {
  const { colors, radius } = useTheme();
  return (
    <View style={[styles.offer, { borderColor: active ? colors.success : colors.border, borderRadius: radius.md, backgroundColor: active ? colors.successSoft : colors.surfaceAlt }]}>
      <Ionicons name="pricetag-outline" size={18} color={active ? colors.successText : colors.accentText} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Text variant="smallStrong" style={{ fontFamily: monoFont }} selectable>{offer.code}</Text>
          <Text variant="small" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>{offer.name}</Text>
        </View>
        <Text variant="small">{offer.description || offer.summary}</Text>
        <Text variant="caption" tone="subtle">
          {offer.summary}{offer.ends_at ? ` · until ${formatDate(offer.ends_at)}` : ''}{offer.new_businesses_only ? ' · first paid subscription only' : ''}
        </Text>
      </View>
      {active ? <Badge label="Applied" tone="success" icon="checkmark" /> : <Button title="Apply" size="sm" variant="secondary" onPress={onApply} />}
    </View>
  );
}

function QuoteLine({ label, value, tone, strong }: { label: string; value: string; tone?: 'success' | 'muted'; strong?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
      <Text variant={strong ? 'bodyStrong' : 'small'} tone={tone === 'muted' ? 'muted' : undefined}>{label}</Text>
      <Text variant={strong ? 'money' : 'small'} tone={tone === 'success' ? 'success' : undefined}>{value}</Text>
    </View>
  );
}

/** UPI ID (copy, QR on big screens, open-in-UPI-app on phones), bank details and instructions. */
export function PaymentCard({ payment, amount, note }: { payment: PaymentDetails; amount: number | null; note: string }) {
  const { colors, radius } = useTheme();
  const { isPhone } = useLayout();
  const hasUpi = !!payment.upi_id?.trim();
  const link = hasUpi ? upiLink({ upiId: payment.upi_id.trim(), payee: payment.payee_name, amount, note }) : '';

  const openUpi = async () => {
    try {
      await Linking.openURL(link);
    } catch {
      toast.warning('No UPI app found. Pay to the UPI ID shown instead.');
    }
  };

  return (
    <View style={{ gap: 14 }}>
      {payment.instructions ? <Text variant="small" tone="muted">{payment.instructions}</Text> : null}
      {hasUpi ? (
        <View style={{ flexDirection: isPhone ? 'column' : 'row', gap: 16, alignItems: isPhone ? 'stretch' : 'center' }}>
          <View style={{ flex: 1, gap: 8, minWidth: 0 }}>
            <Text variant="caption" tone="subtle" style={{ textTransform: 'uppercase' }}>Pay by UPI</Text>
            <View style={[styles.copyBox, { borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceSunken }]}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text variant="bodyStrong" style={{ fontFamily: monoFont }} selectable numberOfLines={1}>{payment.upi_id}</Text>
                {payment.payee_name ? <Text variant="small" tone="muted" numberOfLines={1}>{payment.payee_name}</Text> : null}
              </View>
              <IconButton icon="copy-outline" accessibilityLabel="Copy UPI ID" onPress={() => void copyText(payment.upi_id, 'UPI ID')} />
            </View>
            {amount ? <Text variant="small">Amount: <Text variant="smallStrong">{money(amount)}</Text></Text> : null}
            {isPhone ? <Button title={amount ? `Pay ${money(amount, '₹', true)} in a UPI app` : 'Open a UPI app'} icon="phone-portrait-outline" onPress={openUpi} full /> : null}
          </View>
          {!isPhone ? (
            <View style={{ alignItems: 'center', gap: 6 }}>
              <View style={{ padding: 8, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border }}>
                <QrCode value={link} size={132} />
              </View>
              <Text variant="caption" tone="subtle">Scan with any UPI app</Text>
            </View>
          ) : null}
        </View>
      ) : null}
      {payment.bank_details?.trim() ? (
        <View style={{ gap: 8 }}>
          <Text variant="caption" tone="subtle" style={{ textTransform: 'uppercase' }}>Bank transfer</Text>
          <View style={[styles.copyBox, { borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceSunken, alignItems: 'flex-start' }]}>
            <Text variant="small" selectable style={{ flex: 1, minWidth: 0, fontFamily: monoFont }}>{payment.bank_details}</Text>
            <IconButton icon="copy-outline" accessibilityLabel="Copy bank details" onPress={() => void copyText(payment.bank_details, 'Bank details')} />
          </View>
        </View>
      ) : null}
      {!hasUpi && !payment.bank_details?.trim() ? (
        <Callout tone="neutral">Contact Tallyko support below for payment details.</Callout>
      ) : null}
    </View>
  );
}

/** Phone and email of Tallyko billing support. */
export function SupportLinks({ payment }: { payment: PaymentDetails | null | undefined }) {
  const phone = payment?.support_phone?.trim();
  const email = payment?.support_email?.trim();
  if (!phone && !email) return null;
  const open = (url: string) => Linking.openURL(url).catch(() => toast.info(url.replace(/^(tel|mailto):/, '')));
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {phone ? <Button title={phone} icon="call-outline" variant="secondary" size="sm" onPress={() => void open(`tel:${phone.replace(/\s+/g, '')}`)} /> : null}
      {email ? <Button title={email} icon="mail-outline" variant="secondary" size="sm" onPress={() => void open(`mailto:${email}?subject=${encodeURIComponent('Tallyko subscription')}`)} /> : null}
    </View>
  );
}

/** Payment claims the owner sent: pending, approved, or rejected with Tallyko's reason. */
export function RequestsList({ requests, plans, limit = 5 }: { requests: PaymentRequest[]; plans: SubscriptionPlan[]; limit?: number }) {
  if (!requests.length) return null;
  const name = (key: string) => plans.find((p) => p.key === key)?.name ?? key;
  return (
    <View style={{ gap: 10 }}>
      {requests.slice(0, limit).map((r, i) => {
        const st = REQUEST_STATUS[r.status] ?? REQUEST_STATUS.pending;
        return (
          <View key={r.id} style={{ gap: 6 }}>
            {i > 0 ? <Hairline /> : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', paddingTop: i > 0 ? 6 : 0 }}>
              <Text variant="bodyStrong" style={{ flexShrink: 1 }}>{name(r.plan_key)} · {monthsText(r.months)}</Text>
              <Badge label={st.label} tone={st.tone} />
              <View style={{ flex: 1 }} />
              <Text variant="money">{money(r.amount)}</Text>
            </View>
            <Text variant="small" tone="muted">
              {METHOD_LABEL[r.method] ?? r.method} · Ref <Text variant="small" style={{ fontFamily: monoFont }} selectable>{r.reference}</Text>
              {r.offer_code ? ` · Offer ${r.offer_code}` : ''} · Sent {formatDate(r.created_at)}
            </Text>
            {r.status === 'rejected' ? (
              <Callout tone="danger" title="Reason">{r.review_note || 'Tallyko could not match this payment. Check the reference number, or contact support.'}</Callout>
            ) : r.review_note ? (
              <Text variant="small" tone="muted">Note from Tallyko: {r.review_note}</Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

/** Past and current subscription periods. */
export function HistoryList({ history }: { history: SubscriptionPeriod[] }) {
  if (!history.length) return <Text tone="muted">No subscription periods yet.</Text>;
  const now = Date.now();
  return (
    <View style={{ gap: 10 }}>
      {history.map((h, i) => {
        const start = new Date(h.start_date).getTime();
        const end = new Date(h.end_date).getTime();
        const running = start <= now && now < end;
        return (
          <View key={h.id} style={{ gap: 4 }}>
            {i > 0 ? <Hairline /> : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', paddingTop: i > 0 ? 6 : 0 }}>
              <Text variant="bodyStrong" style={{ flexShrink: 1 }}>{h.plan_name ?? 'Plan'}{h.months ? ` · ${monthsText(h.months)}` : ''}</Text>
              <Badge label={KIND_LABEL[h.kind] ?? h.kind} tone={h.kind === 'paid' ? 'primary' : h.kind === 'trial' ? 'info' : 'neutral'} />
              {running ? <Badge label="Current" tone="success" /> : null}
              <View style={{ flex: 1 }} />
              <Text variant="money">{h.amount_paid ? money(h.amount_paid) : '—'}</Text>
            </View>
            <Text variant="small" tone="muted">
              {formatDate(h.start_date)} – {formatDate(h.end_date)}{h.offer ? ` · ${h.offer}` : ''}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// "I've paid" form
// ---------------------------------------------------------------------------

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'upi', label: 'UPI' }, { value: 'bank_transfer', label: 'Bank transfer' }, { value: 'card', label: 'Card' },
  { value: 'cash', label: 'Cash' }, { value: 'cheque', label: 'Cheque' }, { value: 'other', label: 'Other' },
];

function ClaimForm({ planKey, months, offerCode, quote, onSubmitted }: {
  planKey: string; months: number; offerCode: string | null; quote: Quote | null; onSubmitted: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [amountTouched, setAmountTouched] = useState(false);
  const [method, setMethod] = useState<PaymentMethod>('upi');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  // Follow the quote until the owner types an amount of their own
  useEffect(() => {
    if (!amountTouched && quote) setAmount(quote.amount ? String(quote.amount) : '');
  }, [quote, amountTouched]);

  const value = Number(amount.replace(/[,₹\s]/g, ''));
  const errors = {
    amount: !amount.trim() ? 'Enter the amount you paid.' : !Number.isFinite(value) || value <= 0 ? 'Enter a valid amount.' : undefined,
    reference: reference.trim().length < 4
      ? (method === 'upi' || method === 'bank_transfer' ? 'Enter the UTR / reference number from your payment app or bank (at least 4 characters).' : 'Enter a receipt or reference number (at least 4 characters).')
      : undefined,
  };
  const mismatch = quote && Number.isFinite(value) && value > 0 && Math.abs(value - quote.amount) >= 1;

  const submit = async () => {
    setSubmitted(true);
    setServerError(null);
    if (errors.amount || errors.reference) return;
    setSaving(true);
    try {
      await subscriptionApi.claim({
        plan_key: planKey, months, offer_code: offerCode, amount: value, method, reference: reference.trim(), note: note.trim() || null,
      });
      toast.success("Thanks! We'll confirm your payment shortly.");
      setReference('');
      setNote('');
      setSubmitted(false);
      setAmountTouched(false);
      onSubmitted();
    } catch (e) {
      if (e instanceof ApiError && [400, 409, 429].includes(e.status)) setServerError(e.message);
      else toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={{ gap: 14 }}>
      <FieldRow>
        <Input label="Amount paid" value={amount} prefix="₹" keyboardType="decimal-pad" maxLength={10}
          onChangeText={(v) => { setAmount(v); setAmountTouched(true); }}
          error={submitted ? errors.amount : undefined}
          hint={mismatch ? `The price for this choice is ${money(quote!.amount)}.` : undefined} />
        <Input label="UTR / reference number" value={reference} onChangeText={(v) => { setReference(v); setServerError(null); }}
          autoCapitalize="characters" autoCorrect={false} maxLength={100} placeholder="e.g. 4092 8177 3112"
          error={submitted ? errors.reference : undefined} required />
      </FieldRow>
      <View style={{ gap: 6 }}>
        <Text variant="smallStrong" tone="muted">Paid by</Text>
        <ChoiceChips value={method} options={METHODS} onChange={setMethod} accessibilityLabel="Payment method" />
      </View>
      <Input label="Note for Tallyko (optional)" value={note} onChangeText={setNote} maxLength={300} placeholder="e.g. Paid from PhonePe, name on account" />
      {serverError ? <Callout tone="danger">{serverError}</Callout> : null}
      <Button title="I've paid — send for confirmation" icon="checkmark-done" onPress={submit} loading={saving} style={{ alignSelf: 'flex-start' }} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// The flow
// ---------------------------------------------------------------------------

export function RenewFlow({ info, onSubmitted, allowTwoColumns = true }: {
  info: SubscriptionInfo; onSubmitted: () => void;
  /** Put "choose" and "pay" side by side on wide screens (the full-page lock screen; not inside settings). */
  allowTwoColumns?: boolean;
}) {
  const { colors } = useTheme();
  const { width, isPhone } = useLayout();
  const twoCol = allowTwoColumns && width >= 1180;
  const plans = info.plans;
  const initialPlan = plans.find((p) => p.key === info.plan_key) ?? plans[0];
  const [planKey, setPlanKey] = useState<string | null>(initialPlan?.key ?? null);
  const plan = plans.find((p) => p.key === planKey) ?? initialPlan;
  const [months, setMonths] = useState<number>(defaultMonths(initialPlan));
  const [codeInput, setCodeInput] = useState('');
  const [code, setCode] = useState('');
  const { quote, loading: quoting, error: quoteError } = useQuote(plan?.key ?? null, months, code);

  // Keep the duration valid when switching plans (plans can offer different durations)
  useEffect(() => {
    if (plan && !plan.options.some((o) => o.months === months)) setMonths(defaultMonths(plan));
  }, [plan, months]);

  const applyCode = (c: string) => {
    const clean = c.trim().toUpperCase();
    setCodeInput(clean);
    setCode(clean);
  };
  const offerValid = !!code && !!quote && quote.offer_error == null && quote.offer?.code === code;
  const pending = info.requests.filter((r) => r.status === 'pending');
  const note = useMemo(() => `Tallyko ${plan?.name ?? ''} ${monthsText(months)}`.trim(), [plan, months]);

  if (!plans.length || !plan) {
    return <Callout tone="neutral">No plans are available right now. Contact Tallyko support to renew.</Callout>;
  }

  const choose = (
    <Card style={{ gap: 18 }}>
      <StepTitle n={1} title="Choose a plan" hint="You can change plans at any renewal." />
      <View style={{ flexDirection: isPhone ? 'column' : 'row', flexWrap: 'wrap', gap: 12 }} accessibilityRole="radiogroup">
        {plans.map((p) => (
          <View key={p.key} style={isPhone ? undefined : { flexGrow: 1, flexBasis: 220, minWidth: 0 }}>
            <PlanCard plan={p} selected={p.key === plan.key} current={p.key === info.plan_key} onPress={() => setPlanKey(p.key)} />
          </View>
        ))}
      </View>
      <Hairline />
      <StepTitle n={2} title="How long?" hint="Longer periods cost less per month." />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }} accessibilityRole="radiogroup">
        {plan.options.map((o) => (
          <View key={o.months} style={{ flexGrow: 1, flexBasis: isPhone ? '45%' : 150, minWidth: 0 }}>
            <DurationTile label={o.label} price={o.price} perMonth={o.per_month} saving={o.saving} months={o.months}
              selected={o.months === months} onPress={() => setMonths(o.months)} />
          </View>
        ))}
      </View>
      <Hairline />
      <StepTitle n={3} title="Offer code" hint="Optional. Codes are checked as you type." />
      {info.offers.length ? (
        <View style={{ gap: 8 }}>
          {info.offers.map((o) => (
            <OfferRow key={o.id} offer={o} active={offerValid && quote?.offer?.code === o.code} onApply={() => applyCode(o.code)} />
          ))}
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Input value={codeInput} onChangeText={(v) => { setCodeInput(v.toUpperCase()); if (!v.trim()) setCode(''); }}
            placeholder="Enter offer code" autoCapitalize="characters" autoCorrect={false} maxLength={40} icon="pricetag-outline"
            onSubmitEditing={() => applyCode(codeInput)} accessibilityLabel="Offer code"
            error={code && quote?.offer_error && !quoting ? quote.offer_error : undefined} />
        </View>
        {code && code === codeInput.trim() ? (
          <Button title="Remove" variant="ghost" onPress={() => applyCode('')} />
        ) : (
          <Button title="Apply" variant="secondary" onPress={() => applyCode(codeInput)} disabled={!codeInput.trim()} />
        )}
      </View>
      <View style={[styles.summary, { backgroundColor: colors.surfaceSunken }]}>
        {quoteError ? <Text variant="small" tone="danger">{quoteError}</Text> : null}
        <QuoteLine label={`${plan.name} · ${monthsText(months)}`} value={quote ? money(quote.list_price) : '…'} />
        {quote && quote.discount > 0 ? <QuoteLine label={`Offer ${quote.offer?.code ?? ''}`} value={`− ${money(quote.discount)}`} tone="success" /> : null}
        {quote && quote.extra_days > 0 ? <QuoteLine label="Extra days free" value={`+ ${quote.extra_days} days`} tone="success" /> : null}
        <Hairline />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <Text variant="bodyStrong">Amount to pay</Text>
          <Text variant="moneyLarge" style={{ opacity: quoting ? 0.5 : 1 }}>{quote ? money(quote.amount) : '…'}</Text>
        </View>
      </View>
    </Card>
  );

  const pay = (
    <Card style={{ gap: 18 }}>
      <StepTitle n={4} title="Pay" hint={quote ? `Pay ${money(quote.amount)} to Tallyko.` : undefined} />
      <PaymentCard payment={info.payment} amount={quote?.amount ?? null} note={note} />
      <Hairline />
      <StepTitle n={5} title="Tell us you've paid" hint="Tallyko checks the payment and switches your account on — usually within a few hours." />
      {pending.length ? (
        <Callout tone="info" title={`${pending.length} payment${pending.length === 1 ? '' : 's'} waiting for confirmation`}>
          You don't need to send it again. Send another only if you made a new payment.
        </Callout>
      ) : null}
      <ClaimForm planKey={plan.key} months={months} offerCode={offerValid ? code : null} quote={quote} onSubmitted={onSubmitted} />
    </Card>
  );

  if (twoCol) {
    return (
      <View style={{ flexDirection: 'row', gap: 20, alignItems: 'flex-start' }}>
        <View style={{ flex: 1.15, minWidth: 0 }}>{choose}</View>
        <View style={{ flex: 1, minWidth: 0 }}>{pay}</View>
      </View>
    );
  }
  return (
    <View style={{ gap: 16 }}>
      {choose}
      {pay}
    </View>
  );
}

const styles = StyleSheet.create({
  step: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  planCard: { borderWidth: 1.5, padding: 16, gap: 8, minHeight: 44 },
  duration: { borderWidth: 1.5, paddingVertical: 12, paddingHorizontal: 14, gap: 2, minHeight: 44 },
  offer: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderWidth: 1 },
  copyBox: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 12, paddingRight: 4, paddingVertical: 6, borderWidth: 1 },
  summary: { gap: 8, padding: 14, borderRadius: 12 },
});
