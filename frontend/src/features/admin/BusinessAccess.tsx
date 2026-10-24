/**
 * Business page: subscription access (demo / development / active / grace / locked), signed-in devices, payment history and
 * the "Record payment" sheet (plan durations, offer code with a live quote, kind, goodwill days).
 */
import React, { useEffect, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { errorMessage } from '@/api/client';
import {
  platformApi,
  type BusinessDetail, type DeviceSession, type PaymentMethod, type PlanInfo, type Quote, type RecordKind, type SubscriptionRecord,
} from '@/api/platform';
import { Badge, Button, Card, Chip, Divider, EmptyState, ErrorState, Input, Loading, Segmented, Sheet, Text, confirm, prompt, toast } from '@/components/ui';
import { useApi } from '@/hooks/useApi';
import { ago, formatDateTime, money } from '@/lib/format';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import { Callout, ChoiceChips, FieldRow, KeyValue, SettingSwitch } from '@/features/settings/components';
import {
  ACCESS_LABEL, AccessBadge, KIND_LABEL, KIND_TONE, PAYMENT_METHODS, PAYMENT_METHOD_LABEL, accessDaysText, plural, shortDate, useOnline,
} from './shared';

const DAY = 86_400_000;

function CardTitle({ title, subtitle, right }: { title: string; subtitle?: string; right?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
      <View style={{ flex: 1, minWidth: 180 }}>
        <Text variant="h3" accessibilityRole="header">{title}</Text>
        {subtitle ? <Text variant="small" tone="muted">{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------

const DEMO_CHOICES = [7, 14, 30];

function accessHeadline(b: BusinessDetail): { title: string; detail: string } {
  const a = b.access;
  const kind = a.kind ? KIND_LABEL[a.kind] : null;
  switch (a.state) {
    case 'trial':
      return { title: `Free demo · ${accessDaysText(a)}`, detail: `Until ${shortDate(a.paid_until)}. Locks then unless a payment is recorded.` };
    case 'development':
      return { title: 'Development access', detail: 'Works with no expiry until you switch it off.' };
    case 'active':
      return { title: `${kind && a.kind !== 'paid' ? kind : 'Active'} · ${accessDaysText(a)}`, detail: `Paid until ${shortDate(a.paid_until)}.` };
    case 'grace':
      return { title: 'Grace period', detail: `The paid period ended ${shortDate(a.paid_until)}. Locks on ${shortDate(a.lock_at ?? a.paid_until)}.` };
    default:
      return {
        title: 'Locked',
        detail: a.paid_until
          ? `Subscription ended ${shortDate(a.paid_until)}${b.lapsed_at ? `; devices signed out ${shortDate(b.lapsed_at)}` : ''}. The owner sees the renewal page; data and offline bills are safe.`
          : 'No demo or payment yet. The owner sees the renewal page.',
      };
  }
}

export function AccessCard({ business: b, editable, online, onRecordPayment, onChanged }: {
  business: BusinessDetail; editable: boolean; online: boolean; onRecordPayment: () => void; onChanged: (next?: BusinessDetail) => void;
}) {
  const { colors, radius } = useTheme();
  const [days, setDays] = useState('14');
  const [busy, setBusy] = useState<null | 'demo' | 'dev'>(null);
  const a = b.access;
  const head = accessHeadline(b);
  const daysNum = /^\d+$/.test(days.trim()) ? Number(days.trim()) : NaN;
  const daysError = !(daysNum >= 1 && daysNum <= 365) ? '1–365 days.' : undefined;
  const tone = a.state === 'lapsed' ? colors.dangerSoft : a.state === 'grace' ? colors.warningSoft : a.state === 'development' ? colors.accentSoft
    : a.state === 'trial' ? colors.infoSoft : colors.successSoft;
  const fg = a.state === 'lapsed' ? colors.dangerText : a.state === 'grace' ? colors.warningText : a.state === 'development' ? colors.accentText
    : a.state === 'trial' ? colors.infoText : colors.successText;
  const icon = a.state === 'lapsed' ? 'lock-closed' : a.state === 'grace' ? 'alert-circle' : a.state === 'development' ? 'construct' : a.state === 'trial' ? 'hourglass' : 'checkmark-circle';

  const giveDemo = async () => {
    if (daysError) return;
    const ok = await confirm({
      title: `Give ${b.name} a ${daysNum}-day demo?`, confirmLabel: 'Give demo',
      message: a.state === 'lapsed' || a.state === 'grace'
        ? 'The business is switched on straight away and can sign in and bill again.'
        : `Adds ${daysNum} days after the current end date (${shortDate(a.paid_until)}).`,
    });
    if (!ok) return;
    setBusy('demo');
    try {
      const r = await platformApi.giveDemo(b.id, { days: daysNum });
      toast.success(r ? `${daysNum}-day demo given · works until ${shortDate(r.paid_until)}` : 'Demo given');
      onChanged();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const setDevelopment = async (enabled: boolean) => {
    const ok = await confirm(enabled ? {
      title: 'Give development access?', confirmLabel: 'Turn on',
      message: `${b.name} works with no expiry until you switch this off. Use it for internal testing and pilot shops.`,
    } : {
      title: 'Remove development access?', confirmLabel: 'Turn off', danger: true,
      message: 'The development period ends now. If nothing else is paid, the business is locked (after any grace days) and the owner sees the renewal page.',
    });
    if (!ok) return;
    setBusy('dev');
    try {
      const next = await platformApi.setDevelopment(b.id, { enabled });
      toast.success(enabled ? 'Development access is on' : 'Development access removed');
      onChanged(next);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card style={{ gap: 14 }}>
      <CardTitle title="Access" subtitle="Whether the business can sign in and bill right now." right={<AccessBadge access={a} />} />
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center', padding: 12, borderRadius: radius.md, backgroundColor: tone }}>
        <Ionicons name={icon} size={26} color={fg} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text variant="bodyStrong" color={fg}>{head.title}</Text>
          <Text variant="small" color={colors.text}>{head.detail}</Text>
        </View>
        {a.state !== 'development' && a.state !== 'lapsed' && a.days_left !== null ? (
          <View style={{ alignItems: 'center', minWidth: 56 }}>
            <Text variant="h1" color={fg}>{a.days_left}</Text>
            <Text variant="caption" color={fg}>DAYS LEFT</Text>
          </View>
        ) : null}
      </View>
      {b.status === 'suspended' ? <Text variant="small" tone="danger">Suspended: nobody can sign in, whatever the subscription says.</Text> : null}
      {editable && (a.state === 'lapsed' || a.state === 'grace') ? (
        <Button title="Record payment to unlock" icon="card-outline" variant="success" onPress={onRecordPayment} disabled={!online} style={{ alignSelf: 'flex-start' }} />
      ) : null}

      {editable ? (
        <>
          <Divider />
          {b.development ? (
            <Text variant="small" tone="muted">Development access is on, so a demo isn't needed. Switch it off below to go back to demo or paid access.</Text>
          ) : (
            <View style={{ gap: 8 }}>
              <View>
                <Text variant="bodyStrong">Give a free demo</Text>
                <Text variant="small" tone="muted">Extends a running period, or unlocks a locked business straight away.</Text>
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'flex-start' }}>
                <ChoiceChips value={Number.isFinite(daysNum) && DEMO_CHOICES.includes(daysNum) ? String(daysNum) : ''} onChange={setDays} accessibilityLabel="Demo length"
                  options={DEMO_CHOICES.map((d) => ({ value: String(d), label: `${d} days` }))} />
                <Input value={days} onChangeText={(v) => setDays(v.replace(/[^0-9]/g, ''))} keyboardType="number-pad" maxLength={3}
                  containerStyle={{ width: 84 }} accessibilityLabel="Custom demo days" error={daysError ? ' ' : undefined} placeholder="Days" />
                <Button title={Number.isFinite(daysNum) && !daysError ? `Give ${daysNum}-day demo` : 'Give demo'} icon="gift-outline" variant="secondary"
                  onPress={giveDemo} loading={busy === 'demo'} disabled={!online || !!daysError || busy !== null} />
              </View>
              {daysError && days ? <Text variant="small" tone="danger">{daysError}</Text> : null}
            </View>
          )}
          <Divider />
          <SettingSwitch title="Development access" value={b.development} onValueChange={(v) => void setDevelopment(v)} disabled={!online || busy !== null}
            subtitle={b.development ? 'On: no expiry until you switch it off.' : 'For internal or pilot owners: works with no expiry until switched off.'} />
        </>
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------

const DEVICE_PREVIEW = 5;

function deviceIcon(device: string): keyof typeof Ionicons.glyphMap {
  const d = device.toLowerCase();
  if (d.includes('android') || d.includes('iphone') || d.includes('app')) return 'phone-portrait-outline';
  if (d.includes('windows') || d.includes('mac') || d.includes('linux')) return 'desktop-outline';
  return 'globe-outline';
}

function roleLabel(role: string | null): string {
  return (role ?? 'staff').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

export function DevicesCard({ business: b, editable }: { business: BusinessDetail; editable: boolean }) {
  const { colors } = useTheme();
  const { isPhone } = useLayout();
  const online = useOnline();
  const [showEnded, setShowEnded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const sessions = useApi(() => platformApi.sessions(b.id, showEnded), [b.id, showEnded]);
  const allRows = sessions.data ?? [];
  const rows = showAll ? allRows : allRows.slice(0, DEVICE_PREVIEW);
  const active = allRows.filter((s) => !s.revoked_at);

  const signOutAll = async () => {
    const reason = await prompt({
      title: `Sign out every device of ${b.name}?`, confirmLabel: 'Sign out everywhere', danger: true, minLength: 2,
      message: 'Everyone (owner and staff) is signed out now. Bills waiting on a device stay there and sync after they sign in again.',
      label: 'Reason (kept in the audit log)', placeholder: b.access.locked ? 'e.g. Subscription unpaid' : 'e.g. Owner asked: lost tablet',
    });
    if (!reason?.trim()) return;
    setBusy('all');
    try {
      const r = await platformApi.signOutBusiness(b.id, reason.trim());
      toast.success(r.signed_out ? `Signed out ${plural(r.signed_out, 'device')}` : 'Signed out (no tracked devices were active)');
      void sessions.silentReload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const signOutOne = async (s: DeviceSession) => {
    const reason = await prompt({
      title: `Sign out ${s.name ?? s.email ?? 'this device'}?`, confirmLabel: 'Sign out', danger: true, minLength: 2,
      message: `${s.device}${s.ip ? ` · ${s.ip}` : ''}. They need to sign in again on this device; bills waiting on it stay safe.`,
      label: 'Reason', placeholder: 'e.g. Lost phone',
    });
    if (!reason?.trim()) return;
    setBusy(s.id);
    try {
      await platformApi.revokeSession(s.id, reason.trim());
      toast.success('Device signed out');
      void sessions.silentReload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card style={{ gap: 10 }}>
      <CardTitle title="Signed-in devices"
        subtitle={sessions.data ? (active.length ? `${plural(active.length, 'device')} signed in` : 'No devices signed in') : 'Phones, tablets and browsers using this business.'}
        right={editable && active.length ? (
          <Button title={isPhone ? 'Sign out all' : 'Sign out everywhere'} icon="log-out-outline" variant="danger" size="sm" onPress={signOutAll}
            loading={busy === 'all'} disabled={!online || busy !== null} />
        ) : undefined} />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Chip label="Include signed out" icon={showEnded ? 'checkmark' : 'time-outline'} selected={showEnded} onPress={() => setShowEnded((v) => !v)} />
      </View>
      {sessions.loading && !sessions.data ? <Loading /> : null}
      {sessions.error && !sessions.data ? <ErrorState message={sessions.error} onRetry={sessions.reload} /> : null}
      {sessions.data && rows.length === 0 ? (
        <EmptyState icon="phone-portrait-outline" title="No devices" message="Devices appear here when the owner or staff sign in." />
      ) : null}
      {rows.map((s, i) => {
        const ended = !!s.revoked_at;
        return (
          <View key={s.id}>
            {i > 0 ? <Divider style={{ marginBottom: 10 }} /> : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, opacity: ended ? 0.7 : 1 }}>
              <Ionicons name={deviceIcon(s.device)} size={22} color={ended ? colors.textSubtle : colors.textMuted} />
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <Text variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>{s.name ?? s.email ?? 'Unknown user'}</Text>
                  <Badge label={roleLabel(s.role)} tone={s.role === 'owner' ? 'accent' : 'neutral'} />
                  {ended ? <Badge label="Signed out" tone="neutral" /> : null}
                </View>
                <Text variant="small" tone="muted" numberOfLines={1}>{s.device}{s.ip ? ` · ${s.ip}` : ''}</Text>
                <Text variant="caption" tone="subtle" numberOfLines={2}>
                  {ended
                    ? `Signed out ${formatDateTime(s.revoked_at)}${s.revoked_reason ? ` · ${s.revoked_reason}` : ''}`
                    : `Active ${s.last_seen_at ? `${ago(s.last_seen_at)} ago` : 'recently'} · signed in ${formatDateTime(s.created_at)}`}
                </Text>
              </View>
              {editable && !ended ? (
                <Button title={isPhone ? undefined : 'Sign out'} icon="log-out-outline" size="sm" variant="ghost" accessibilityLabel={`Sign out ${s.name ?? 'device'}`}
                  onPress={() => void signOutOne(s)} loading={busy === s.id} disabled={!online || busy !== null} />
              ) : null}
            </View>
          </View>
        );
      })}
      {allRows.length > DEVICE_PREVIEW ? (
        <Button title={showAll ? 'Show fewer' : `Show all ${allRows.length}`} size="sm" variant="ghost" icon={showAll ? 'chevron-up' : 'chevron-down'}
          onPress={() => setShowAll((v) => !v)} style={{ alignSelf: 'flex-start' }} />
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Payment history
// ---------------------------------------------------------------------------

function periodText(s: SubscriptionRecord): string {
  const start = new Date(s.start_date).getTime();
  const end = new Date(s.end_date).getTime();
  if (s.kind === 'development' || new Date(s.end_date).getUTCFullYear() >= 2099) return `from ${shortDate(s.start_date)} · no expiry`;
  const span = s.months ? `${s.months} month${s.months === 1 ? '' : 's'}` : `${Math.max(0, Math.round((end - start) / DAY))} days`;
  return `${span} · ${shortDate(s.start_date)} → ${shortDate(s.end_date)}`;
}

export function PaymentsCard({ business: b, planName, editable, online, onRecord }: {
  business: BusinessDetail; planName: string; editable: boolean; online: boolean; onRecord: () => void;
}) {
  const received = b.subscriptions.reduce((n, s) => n + (Number(s.amount_paid) || 0), 0);
  const a = b.access;
  return (
    <Card style={{ gap: 12 }}>
      <CardTitle title="Subscription & payments"
        subtitle={a.paid_until ? `${planName} · ${a.state === 'development' ? 'development access' : `${ACCESS_LABEL[a.state].toLowerCase()} · until ${shortDate(a.paid_until)}`}` : 'No demo or payment recorded yet.'}
        right={editable ? <Button title="Record payment" icon="add" size="sm" onPress={onRecord} disabled={!online} /> : undefined} />
      {a.state === 'active' && a.days_left !== null && a.days_left <= 7 ? (
        <Callout tone="warning">Renewal due {a.days_left === 0 ? 'today' : `in ${plural(a.days_left, 'day')}`}.</Callout>
      ) : null}
      {b.subscriptions.length === 0 ? (
        <Text variant="small" tone="subtle">Payments, demos and complimentary periods appear here with their period, amount and offer.</Text>
      ) : (
        <View>
          {b.subscriptions.map((s, i) => {
            const kind = s.kind ?? 'paid';
            return (
              <View key={s.id ?? `${s.start_date}-${i}`}>
                {i > 0 ? <Divider /> : null}
                <View style={{ paddingVertical: 10, gap: 4 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <Text variant="bodyStrong" style={{ flex: 1, minWidth: 90 }} numberOfLines={1}>
                      {kind === 'paid' || Number(s.amount_paid) ? money(Number(s.amount_paid) || 0) : KIND_LABEL[kind]}
                    </Text>
                    <Badge label={KIND_LABEL[kind] ?? kind} tone={KIND_TONE[kind] ?? 'neutral'} />
                    {s.payment_method && s.payment_method !== 'free' ? <Badge label={PAYMENT_METHOD_LABEL[s.payment_method] ?? s.payment_method} tone="neutral" /> : null}
                    {s.offer ? <Badge label={s.offer.code ?? s.offer.name} tone="accent" icon="gift-outline" /> : null}
                  </View>
                  <Text variant="small" tone="muted">{s.plan_name ?? s.plan_key} · {periodText(s)}</Text>
                  {kind === 'paid' && (s.discount || s.extra_days || (s.list_price && Number(s.list_price) !== Number(s.amount_paid))) ? (
                    <Text variant="small" tone="subtle">
                      {[s.list_price ? `List ${money(s.list_price)}` : null, s.discount ? `offer −${money(s.discount)}` : null,
                        s.extra_days ? `+${s.extra_days} days free` : null].filter(Boolean).join(' · ')}
                    </Text>
                  ) : null}
                  {s.payment_reference || s.note ? (
                    <Text variant="small" tone="subtle" selectable numberOfLines={2}>
                      {s.payment_reference ? `Ref ${s.payment_reference}` : ''}{s.payment_reference && s.note ? ' · ' : ''}{s.note ?? ''}
                    </Text>
                  ) : null}
                  {s.recorded_by ? <Text variant="caption" tone="subtle">By {s.recorded_by}{s.paid_at ? ` · ${shortDate(s.paid_at.endsWith('Z') ? s.paid_at : `${s.paid_at}Z`)}` : ''}</Text> : null}
                </View>
              </View>
            );
          })}
          <Divider style={{ marginVertical: 6 }} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text variant="smallStrong" tone="muted">Total received</Text>
            <Text variant="smallStrong">{money(received)}</Text>
          </View>
        </View>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Record payment
// ---------------------------------------------------------------------------

const NEEDS_REFERENCE: PaymentMethod[] = ['upi', 'bank_transfer', 'card', 'cheque'];
const KINDS: { value: RecordKind; label: string }[] = [
  { value: 'paid', label: 'Paid' }, { value: 'complimentary', label: 'Complimentary' }, { value: 'trial', label: 'Demo' },
];
const GOODWILL_CHOICES = [0, 7, 15, 30];

function useDebounced<T>(value: T, ms = 400): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

function DurationTile({ title, price, sub, saving, selected, onPress }: {
  title: string; price?: string; sub?: string; saving?: string; selected: boolean; onPress: () => void;
}) {
  const { colors, radius } = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="radio" accessibilityState={{ checked: selected }} accessibilityLabel={`${title}${price ? ` ${price}` : ''}`}
      style={({ hovered }: any) => [
        { flexGrow: 1, flexBasis: 150, minHeight: 64, padding: 10, borderRadius: radius.md, borderWidth: 1, gap: 2,
          borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? colors.primarySoft : hovered ? colors.surfaceSunken : colors.surface },
        Platform.OS === 'web' && ({ cursor: 'pointer' } as any),
      ]}>
      <Text variant="smallStrong" color={selected ? colors.primarySoftText : colors.text} numberOfLines={1}>{title}</Text>
      {price ? <Text variant="bodyStrong" color={selected ? colors.primarySoftText : colors.text}>{price}</Text> : null}
      {sub ? <Text variant="caption" tone="subtle" numberOfLines={1}>{sub}</Text> : null}
      {saving ? <Text variant="caption" tone="success" numberOfLines={1}>{saving}</Text> : null}
    </Pressable>
  );
}

export function RecordPaymentSheet({ business: b, plans, onClose, onDone }: { business: BusinessDetail; plans: PlanInfo[]; onClose: () => void; onDone: () => void }) {
  const online = useOnline();
  const options = plans.filter((p) => p.is_active || p.key === b.plan_key);
  const [planKey, setPlanKey] = useState(options.some((p) => p.key === b.plan_key) ? b.plan_key : options[0]?.key ?? b.plan_key);
  const plan = plans.find((p) => p.key === planKey) ?? null;
  const priceOptions = plan?.price_options ?? [];
  const [kind, setKind] = useState<RecordKind>('paid');
  const [months, setMonths] = useState(() => String((priceOptions.find((o) => o.months === 12) ?? priceOptions[priceOptions.length - 1])?.months ?? 12));
  const [custom, setCustom] = useState(false);
  const [offerCode, setOfferCode] = useState('');
  const [goodwill, setGoodwill] = useState('0');
  const [amount, setAmount] = useState('');
  const [amountTouched, setAmountTouched] = useState(false);
  const [method, setMethod] = useState<PaymentMethod>('upi');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [quote, setQuote] = useState<{ loading: boolean; data: Quote | null; error: string | null }>({ loading: false, data: null, error: null });

  const monthsNum = /^\d+$/.test(months.trim()) ? Number(months.trim()) : NaN;
  const goodwillNum = /^\d+$/.test(goodwill.trim()) ? Number(goodwill.trim()) : NaN;
  const option = priceOptions.find((o) => o.months === monthsNum) ?? null;
  const listPrice = option ? option.price : plan && Number.isFinite(monthsNum) ? Math.round(plan.price_monthly * monthsNum * 100) / 100 : 0;
  const code = offerCode.trim().toUpperCase();
  const debouncedCode = useDebounced(code);
  const paid = kind === 'paid';

  // Live quote for the offer code (the server checks dates, plans, minimum months, first-payment rules)
  useEffect(() => {
    if (!paid || !debouncedCode || !Number.isFinite(monthsNum) || monthsNum < 1 || monthsNum > 60) {
      setQuote({ loading: false, data: null, error: null });
      return undefined;
    }
    let cancelled = false;
    setQuote((q) => ({ ...q, loading: true }));
    platformApi.quote(b.id, { plan_key: planKey, months: monthsNum, offer_code: debouncedCode })
      .then((data) => { if (!cancelled) setQuote({ loading: false, data, error: null }); })
      .catch((e) => { if (!cancelled) setQuote({ loading: false, data: null, error: errorMessage(e) }); });
    return () => { cancelled = true; };
  }, [paid, debouncedCode, planKey, monthsNum, b.id]);

  const quoteFresh = !!quote.data && quote.data.plan_key === planKey && quote.data.months === monthsNum && code === debouncedCode;
  const offerOk = paid && !!code && quoteFresh && !quote.data!.offer_error && !!quote.data!.offer;
  const offerError = paid && code && quoteFresh ? quote.data!.offer_error : paid && code && quote.error && code === debouncedCode ? quote.error : null;
  const discount = offerOk ? quote.data!.discount : 0;
  const offerDays = offerOk ? quote.data!.extra_days : 0;
  const due = paid ? Math.max(0, Math.round((listPrice - discount) * 100) / 100) : 0;

  // Suggested amount follows the price until the admin types their own
  useEffect(() => {
    if (!amountTouched) setAmount(String(due));
  }, [due, amountTouched]);

  const changeKind = (k: RecordKind) => {
    setKind(k);
    setMethod(k === 'paid' ? 'upi' : 'free');
    setAmountTouched(false);
  };

  const amountNum = Number(amount.replace(/,/g, '').trim());
  const errors = {
    months: !(monthsNum >= 1 && monthsNum <= 60) ? 'Between 1 and 60 months.' : undefined,
    goodwill: !(goodwillNum >= 0 && goodwillNum <= 365) ? '0–365 days.' : undefined,
    amount: amount.trim() === '' || !Number.isFinite(amountNum) || amountNum < 0 ? 'Enter the amount received (0 for free).' : amountNum > 10_000_000 ? 'Too large.' : undefined,
    reference: paid && NEEDS_REFERENCE.includes(method) && !reference.trim() ? 'Add the UTR / transaction or cheque number.' : undefined,
    offer: offerError ? `${offerError}. Fix or clear the code.` : paid && code && (quote.loading || code !== debouncedCode) ? 'Checking the code…' : undefined,
  };
  const show = (k: keyof typeof errors) => (submitted ? errors[k] : undefined);

  // Mirrors the backend: continues from the current paid-until date (or today if it has ended)
  const paidUntil = b.access.paid_until ? new Date(b.access.paid_until).getTime() : 0;
  const start = Math.max(paidUntil, Date.now());
  const totalDays = (Number.isFinite(monthsNum) ? monthsNum * 30 : 0) + (Number.isFinite(goodwillNum) ? goodwillNum : 0) + offerDays;
  const end = new Date(start + totalDays * DAY);

  const submit = async () => {
    setSubmitted(true);
    setFormError(null);
    if (Object.values(errors).some(Boolean)) return;
    setSaving(true);
    try {
      const r = await platformApi.recordSubscription(b.id, {
        plan_key: planKey, months: monthsNum, amount_paid: amountNum, payment_method: method, kind,
        payment_reference: reference.trim() || null, note: note.trim() || null,
        offer_code: offerOk ? code : null, extra_days: goodwillNum || 0,
      });
      toast.success(`${KIND_LABEL[kind]} recorded · works until ${shortDate(r.paid_until)}`);
      onDone();
    } catch (e) {
      setFormError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const pickMonths = (m: number) => {
    setCustom(false);
    setMonths(String(m));
  };

  return (
    <Sheet visible onClose={onClose} title="Record payment" subtitle={`${b.name} · renewal, new subscription or a free period`} width={680}
      footer={
        <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'flex-end', alignItems: 'center', flexWrap: 'wrap' }}>
          <Text variant="smallStrong" tone="muted" style={{ flex: 1, minWidth: 160 }}>
            {Number.isFinite(amountNum) ? `${money(amountNum)} · until ${shortDate(end.toISOString())}` : ''}
          </Text>
          <Button title="Cancel" variant="secondary" onPress={onClose} disabled={saving} />
          <Button title={paid ? 'Record payment' : `Record ${KIND_LABEL[kind].toLowerCase()}`} icon="checkmark" onPress={submit} loading={saving}
            disabled={!online || !plans.length} />
        </View>
      }>
      {formError ? <Callout tone="danger">{formError}</Callout> : null}

      <View style={{ gap: 6 }}>
        <Text variant="smallStrong" tone="muted">Type</Text>
        <View style={{ maxWidth: 440 }}>
          <Segmented value={kind} options={KINDS} onChange={changeKind} />
        </View>
        <Text variant="small" tone="subtle">
          {kind === 'paid' ? 'Money received for a plan.' : kind === 'complimentary' ? 'A free period you give (goodwill, partner shops). Shows as complimentary.' : 'A free demo period of the chosen plan.'}
        </Text>
      </View>

      <View style={{ gap: 6 }}>
        <Text variant="smallStrong" tone="muted">Plan</Text>
        {options.length ? (
          <ChoiceChips value={planKey} onChange={(k) => {
            setPlanKey(k);
            setAmountTouched(false);
            const next = plans.find((p) => p.key === k)?.price_options ?? [];
            if (!custom && next.length && !next.some((o) => o.months === monthsNum)) {
              setMonths(String((next.find((o) => o.months === 12) ?? next[next.length - 1])!.months));
            }
          }} accessibilityLabel="Plan"
            options={options.map((p) => ({ value: p.key, label: `${p.name} · ${money(p.price_monthly, '₹', true)}/mo` }))} />
        ) : <Text variant="small" tone="danger">Plans couldn't be loaded. Close and refresh the page.</Text>}
        {planKey !== b.plan_key ? <Text variant="small" tone="warning">The business moves to this plan when you record this.</Text> : null}
      </View>

      <View style={{ gap: 6 }}>
        <Text variant="smallStrong" tone="muted">Duration</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} accessibilityRole="radiogroup">
          {priceOptions.map((o) => (
            <DurationTile key={o.months} title={o.label} selected={!custom && monthsNum === o.months} onPress={() => pickMonths(o.months)}
              price={paid ? money(o.price, '₹', true) : `${o.months} month${o.months === 1 ? '' : 's'}`}
              sub={paid && o.months > 1 ? `${money(o.per_month, '₹', true)}/mo` : undefined}
              saving={paid && o.saving > 0 ? `Save ${money(o.saving, '₹', true)}` : undefined} />
          ))}
          <DurationTile title="Custom" selected={custom || (!option && Number.isFinite(monthsNum))} onPress={() => setCustom(true)}
            sub="Any number of months" price={custom || !option ? (Number.isFinite(monthsNum) ? `${monthsNum} mo` : '—') : undefined} />
        </View>
        {custom || !option ? (
          <Input label="Months" value={months} onChangeText={(v) => { setCustom(true); setMonths(v.replace(/[^0-9]/g, '')); }} keyboardType="number-pad" maxLength={2}
            containerStyle={{ maxWidth: 160 }} error={show('months')} hint={paid && plan ? `${money(plan.price_monthly, '₹', true)} × months` : undefined} />
        ) : null}
      </View>

      {paid ? (
        <View style={{ gap: 6 }}>
          <Input label="Offer code" value={offerCode} onChangeText={(v) => setOfferCode(v.toUpperCase().replace(/[^A-Z0-9_-]/g, ''))} maxLength={30}
            autoCapitalize="characters" autoCorrect={false} placeholder="e.g. DIWALI25" containerStyle={{ maxWidth: 320 }}
            right={offerCode ? <Button icon="close" size="sm" variant="ghost" accessibilityLabel="Clear offer code" onPress={() => setOfferCode('')} /> : undefined} />
          {code && (quote.loading || code !== debouncedCode) ? <Text variant="small" tone="subtle">Checking the code…</Text> : null}
          {offerOk ? (
            <Callout tone="success" icon="gift-outline" title={`${quote.data!.offer!.name} applied`}>
              {`${quote.data!.offer!.summary}: ${discount ? `−${money(discount)}` : 'no discount'}${offerDays ? ` · +${offerDays} days free` : ''}`}
            </Callout>
          ) : null}
          {offerError ? <Callout tone="danger">{`${code}: ${offerError}`}</Callout> : null}
        </View>
      ) : null}

      <View style={{ gap: 6 }}>
        <Text variant="smallStrong" tone="muted">Extra goodwill days</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'flex-start' }}>
          <ChoiceChips value={Number.isFinite(goodwillNum) && GOODWILL_CHOICES.includes(goodwillNum) ? String(goodwillNum) : ''} onChange={setGoodwill}
            accessibilityLabel="Extra goodwill days" options={GOODWILL_CHOICES.map((d) => ({ value: String(d), label: d === 0 ? 'None' : `+${d} days` }))} />
          <Input value={goodwill} onChangeText={(v) => setGoodwill(v.replace(/[^0-9]/g, ''))} keyboardType="number-pad" maxLength={3}
            containerStyle={{ width: 84 }} accessibilityLabel="Custom goodwill days" error={show('goodwill') ? ' ' : undefined} />
        </View>
        {show('goodwill') ? <Text variant="small" tone="danger">{show('goodwill')}</Text> : null}
      </View>

      <Card style={{ gap: 2 }}>
        {paid ? <KeyValue label="List price" value={Number.isFinite(monthsNum) ? `${money(listPrice)}${option ? ` · ${option.label}` : ''}` : '—'} /> : null}
        {paid && discount ? <KeyValue label="Offer discount" value={`−${money(discount)}`} /> : null}
        {paid ? <KeyValue label="Amount due" value={money(due)} /> : null}
        <KeyValue label="Period" value={`${Number.isFinite(monthsNum) ? `${monthsNum} mo` : '—'}${goodwillNum ? ` + ${goodwillNum} d goodwill` : ''}${offerDays ? ` + ${offerDays} d offer` : ''}`} />
        <KeyValue label="Covers" value={`${shortDate(new Date(start).toISOString())} → ${shortDate(end.toISOString())}`} />
      </Card>

      <FieldRow>
        <Input label="Amount received" required prefix="₹" value={amount} onChangeText={(v) => { setAmountTouched(true); setAmount(v.replace(/[^0-9.]/g, '')); }}
          keyboardType="decimal-pad" maxLength={11} error={show('amount')}
          hint={amountTouched && paid && Number.isFinite(amountNum) && Math.abs(amountNum - due) >= 0.5 ? `Differs from the amount due (${money(due)})` : undefined} />
        <Input label="Reference" value={reference} onChangeText={setReference} maxLength={100} error={show('reference')}
          placeholder="UTR / transaction no." autoCapitalize="characters" required={paid && NEEDS_REFERENCE.includes(method)} />
      </FieldRow>
      <View style={{ gap: 6 }}>
        <Text variant="smallStrong" tone="muted">Payment method</Text>
        <ChoiceChips value={method} onChange={setMethod} accessibilityLabel="Payment method" options={PAYMENT_METHODS} />
      </View>
      <Input label="Note (optional)" value={note} onChangeText={setNote} maxLength={300} placeholder="e.g. Paid at the Pune expo" />
      {submitted && errors.offer ? <Text variant="small" tone="danger">{errors.offer}</Text> : null}
      {b.access.locked ? <Callout tone="success">This business is locked. Recording this unlocks it straight away.</Callout> : null}
      {b.status === 'suspended' && (b.status_reason ?? '').toLowerCase().startsWith('payment') ? (
        <Callout tone="success">This business was suspended for payment. Recording this reactivates it.</Callout>
      ) : null}
    </Sheet>
  );
}
