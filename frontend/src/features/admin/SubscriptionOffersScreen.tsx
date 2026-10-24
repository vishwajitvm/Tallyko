/**
 * Subscription offers: launch promotions on Tallyko's own plans (Diwali 25% off yearly, a free welcome month...).
 * Owners type the code on the renewal page; super admins can also apply it when recording a payment.
 */
import React, { useMemo, useState } from 'react';
import { Pressable, Switch, View } from 'react-native';
import { errorMessage } from '@/api/client';
import { platformApi, type DiscountType, type PlanInfo, type SubscriptionOffer, type SubscriptionOfferBody } from '@/api/platform';
import { Badge, Button, Card, Chip, DataList, Divider, FilterBar, Input, Segmented, Sheet, Text, toast, type BadgeTone, type DataColumn } from '@/components/ui';
import { useApi } from '@/hooks/useApi';
import { money } from '@/lib/format';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import { Callout, ChoiceChips, FieldRow, SettingSwitch, monoFont } from '@/features/settings/components';
import { fieldErrorsFrom } from '@/features/settings/validation';
import { AdminListFrame, ReadOnlyNote, istDate, istMidnightIso, plural, useCanEdit, useOnline } from './shared';

type OfferState = 'live' | 'scheduled' | 'ended' | 'used_up' | 'paused';
const STATE_LABEL: Record<OfferState, string> = { live: 'Live', scheduled: 'Scheduled', ended: 'Ended', used_up: 'Fully used', paused: 'Paused' };
const STATE_TONE: Record<OfferState, BadgeTone> = { live: 'success', scheduled: 'info', ended: 'neutral', used_up: 'warning', paused: 'neutral' };
const STATE_ORDER: Record<OfferState, number> = { live: 0, scheduled: 1, used_up: 2, paused: 3, ended: 4 };

function offerState(o: SubscriptionOffer, now = Date.now()): OfferState {
  if (!o.is_active) return 'paused';
  if (o.ends_at && new Date(o.ends_at).getTime() <= now) return 'ended';
  if (o.starts_at && new Date(o.starts_at).getTime() > now) return 'scheduled';
  if (o.max_redemptions && o.redemptions >= o.max_redemptions) return 'used_up';
  return 'live';
}

/** IST calendar date (YYYY-MM-DD) of an instant. */
function istDateOf(iso: string, offsetMs = 0): string {
  return new Date(new Date(iso).getTime() + offsetMs + 330 * 60_000).toISOString().slice(0, 10);
}

/** "3 Nov 2026" for a YYYY-MM-DD date (no timezone shift). */
function dayText(ymd: string): string {
  return new Date(`${ymd}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Last day an offer can be used (ends_at is exclusive). */
function lastDay(o: { ends_at: string | null }): string {
  return o.ends_at ? istDateOf(o.ends_at, -1) : '';
}

function bodyFrom(o: SubscriptionOffer): SubscriptionOfferBody {
  return {
    name: o.name, description: o.description, code: o.code, discount_type: o.discount_type, discount_value: o.discount_value, extra_days: o.extra_days,
    plan_keys: o.plan_keys, min_months: o.min_months, starts_at: o.starts_at, ends_at: o.ends_at, max_redemptions: o.max_redemptions,
    new_businesses_only: o.new_businesses_only, show_to_owners: o.show_to_owners, is_active: o.is_active,
  };
}

export default function SubscriptionOffersScreen() {
  const { colors } = useTheme();
  const { isPhone } = useLayout();
  const canEdit = useCanEdit();
  const online = useOnline();
  const offers = useApi(() => platformApi.subscriptionOffers(), []);
  const plans = useApi(() => platformApi.plans(), []);
  const [editing, setEditing] = useState<SubscriptionOffer | 'new' | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | OfferState>('all');
  const [query, setQuery] = useState('');
  const planList = plans.data?.plans ?? [];
  const sorted = useMemo(() => [...(offers.data ?? [])].sort((a, b) => STATE_ORDER[offerState(a)] - STATE_ORDER[offerState(b)]), [offers.data]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: sorted.length };
    for (const o of sorted) c[offerState(o)] = (c[offerState(o)] ?? 0) + 1;
    return c;
  }, [sorted]);
  const q = query.trim().toLowerCase();
  const shown = useMemo(() => sorted.filter((o) => (filter === 'all' || offerState(o) === filter)
    && (!q || o.name.toLowerCase().includes(q) || (o.code ?? '').toLowerCase().includes(q))), [sorted, filter, q]);

  const replace = (next: SubscriptionOffer) => {
    offers.setData((list) => {
      const rows = list ?? [];
      return rows.some((o) => o.id === next.id) ? rows.map((o) => (o.id === next.id ? next : o)) : [next, ...rows];
    });
  };

  /** Pausing is reversible, so it happens straight away with Undo in the toast; payments already made keep their discount. */
  const toggle = async (o: SubscriptionOffer, value: boolean) => {
    setToggling(o.id);
    try {
      const next = await platformApi.updateSubscriptionOffer(o.id, { ...bodyFrom(o), is_active: value });
      replace(next);
      if (value) toast.success(`${o.name} is on`);
      else toast.undo(`${o.name} paused`, () => void toggle(next, true));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setToggling(null);
    }
  };

  const activeSwitch = (o: SubscriptionOffer) => (canEdit ? (
    <Pressable onPress={() => undefined} accessible={false} style={{ padding: 4 }}>
      <Switch value={o.is_active} onValueChange={(v) => void toggle(o, v)} disabled={!online || toggling === o.id}
        trackColor={{ true: colors.primary, false: colors.borderStrong }} thumbColor={colors.surface}
        accessibilityLabel={`${o.name} active`} />
    </Pressable>
  ) : <Badge label={o.is_active ? 'On' : 'Off'} tone={o.is_active ? 'success' : 'neutral'} />);

  const usedText = (o: SubscriptionOffer) => (o.max_redemptions ? `${o.redemptions}/${o.max_redemptions}` : String(o.redemptions));
  const validText = (o: SubscriptionOffer) => (o.ends_at ? `till ${dayText(lastDay(o))}` : o.starts_at ? `from ${dayText(istDateOf(o.starts_at))}` : 'Always');

  const columns: DataColumn<SubscriptionOffer>[] = [
    { key: 'name', title: 'Offer', flex: 2.4, render: (o) => (
      <View style={{ minWidth: 0 }}>
        <Text variant="bodyStrong" numberOfLines={1}>{o.name}</Text>
        <Text variant="small" tone="primary" numberOfLines={1}>{o.summary}</Text>
      </View>
    ) },
    { key: 'code', title: 'Code', width: 130, render: (o) => (o.code
      ? <Text variant="smallStrong" style={{ fontFamily: monoFont, letterSpacing: 1 }} numberOfLines={1} selectable>{o.code}</Text>
      : <Text variant="small" tone="subtle">No code</Text>) },
    { key: 'plans', title: 'Plans', flex: 1.2, hideBelow: 1000, value: (o) => `${planNames(o.plan_keys, planList)}${o.min_months > 1 ? ` · ${o.min_months}+ mo` : ''}` },
    { key: 'valid', title: 'Valid', width: 130, hideBelow: 820, value: validText },
    { key: 'used', title: 'Used', width: 70, numeric: true, hideBelow: 700, value: usedText },
    { key: 'state', title: 'State', width: 110, render: (o) => <Badge label={STATE_LABEL[offerState(o)]} tone={STATE_TONE[offerState(o)]} /> },
  ];

  const renderCard = (o: SubscriptionOffer) => (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>{o.name}</Text>
        <Badge label={STATE_LABEL[offerState(o)]} tone={STATE_TONE[offerState(o)]} />
      </View>
      <Text variant="small" tone="primary" numberOfLines={1}>{o.summary}</Text>
      <Text variant="caption" tone="muted" numberOfLines={1}>{o.code ?? 'No code'} · {validText(o)} · used {usedText(o)}</Text>
    </View>
  );

  return (
    <AdminListFrame
      title="Subscription offers"
      subtitle="Promotions on Tallyko plans: a discount, extra free days, or both. Owners enter the code when they renew."
      actions={canEdit ? <Button title={isPhone ? 'New' : 'New offer'} icon="add" onPress={() => setEditing('new')} /> : null}
      toolbar={
        <View style={{ gap: 8 }}>
          <FilterBar onSearch={setQuery} searchPlaceholder="Offer name or code" value={filter} onChange={(k) => setFilter(k as 'all' | OfferState)}
            filters={[{ key: 'all', label: 'All', count: counts.all }, ...(['live', 'scheduled', 'used_up', 'paused', 'ended'] as OfferState[])
              .map((k) => ({ key: k, label: STATE_LABEL[k], count: counts[k] ?? 0 }))]} />
          {!canEdit ? <ReadOnlyNote what="create or change offers" /> : null}
        </View>
      }
    >
      <DataList
        data={shown}
        keyExtractor={(o) => o.id}
        columns={columns}
        renderCard={renderCard}
        rowHeight={58}
        cardHeight={92}
        tableMinWidth={620}
        loading={offers.loading && !offers.data}
        error={offers.error}
        onRetry={offers.reload}
        refreshing={offers.refreshing}
        onRefresh={() => { void offers.reload(); void plans.reload(); }}
        onPressRow={canEdit ? (o) => setEditing(o) : undefined}
        keyboard={!editing}
        rowActions={activeSwitch}
        rowActionsWidth={72}
        extraData={toggling}
        empty={q || filter !== 'all'
          ? { icon: 'search-outline', title: 'No offers match', message: 'Try another name or filter.' }
          : { icon: 'pricetags-outline', title: 'No offers yet', message: 'Launch a festive discount or a welcome month to win new shops.',
            action: canEdit ? { label: 'New offer', icon: 'add', onPress: () => setEditing('new') } : undefined }}
      />

      {editing ? (
        <OfferSheet offer={editing === 'new' ? null : editing} plans={planList} existing={offers.data ?? []} onClose={() => setEditing(null)}
          onSaved={(next) => { replace(next); setEditing(null); }} />
      ) : null}
    </AdminListFrame>
  );
}

const DISCOUNT_TYPES: { value: DiscountType; label: string }[] = [
  { value: 'percent', label: '% off' }, { value: 'flat', label: '₹ off' }, { value: 'none', label: 'No discount' },
];
const EXTRA_DAY_CHOICES = [0, 7, 15, 30];
const MIN_MONTH_CHOICES = [1, 3, 6, 12];

function planNames(keys: string[] | null, plans: PlanInfo[]): string {
  if (!keys?.length) return 'All plans';
  return keys.map((k) => plans.find((p) => p.key === k)?.name ?? k).join(', ');
}

function previewSummary(type: DiscountType, value: number, extra: number, minMonths: number, planKeys: string[], plans: PlanInfo[]): string {
  const parts: string[] = [];
  if (type === 'percent' && value > 0) parts.push(`${Number(value.toFixed(2))}% off`);
  else if (type === 'flat' && value > 0) parts.push(`${money(value, '₹', true)} off`);
  if (extra > 0) parts.push(`${extra} extra days free`);
  if (minMonths > 1) parts.push(`on ${minMonths}+ months`);
  if (planKeys.length) parts.push(`on ${planNames(planKeys, plans)}`);
  return parts.join(' ');
}

function OfferSheet({ offer, plans, existing, onClose, onSaved }: {
  offer: SubscriptionOffer | null; plans: PlanInfo[]; existing: SubscriptionOffer[]; onClose: () => void; onSaved: (o: SubscriptionOffer) => void;
}) {
  const online = useOnline();
  const isNew = !offer;
  const [name, setName] = useState(offer?.name ?? '');
  const [code, setCode] = useState(offer?.code ?? '');
  const [description, setDescription] = useState(offer?.description ?? '');
  const [type, setType] = useState<DiscountType>(offer?.discount_type ?? 'percent');
  const [value, setValue] = useState(offer && offer.discount_type !== 'none' ? String(offer.discount_value) : '');
  const [extra, setExtra] = useState(String(offer?.extra_days ?? 0));
  const [planKeys, setPlanKeys] = useState<string[]>(offer?.plan_keys ?? []);
  const [minMonths, setMinMonths] = useState(String(offer?.min_months ?? 1));
  const startOriginal = offer?.starts_at ? istDateOf(offer.starts_at) : '';
  const endOriginal = offer ? lastDay(offer) : '';
  const [start, setStart] = useState(startOriginal);
  const [end, setEnd] = useState(endOriginal);
  const [maxUses, setMaxUses] = useState(offer?.max_redemptions ? String(offer.max_redemptions) : '');
  const [newOnly, setNewOnly] = useState(offer?.new_businesses_only ?? false);
  const [showOwners, setShowOwners] = useState(offer?.show_to_owners ?? true);
  const [active, setActive] = useState(offer?.is_active ?? true);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const valueNum = Number(value.trim() || '0');
  const extraNum = /^\d+$/.test(extra.trim()) ? Number(extra.trim()) : NaN;
  const minNum = /^\d+$/.test(minMonths.trim()) ? Number(minMonths.trim()) : NaN;
  const maxNum = maxUses.trim() ? Number(maxUses.trim()) : null;
  const startIso = start.trim() ? istMidnightIso(start) : null;
  const endIso = end.trim() ? istMidnightIso(end) : null;
  const codeUpper = code.trim().toUpperCase();

  const errors: Record<string, string | undefined> = {
    name: name.trim().length < 2 ? 'At least 2 characters.' : undefined,
    code: codeUpper && !/^[A-Z0-9_-]{3,30}$/.test(codeUpper) ? '3–30 letters, digits, - or _.'
      : codeUpper && existing.some((o) => o.code === codeUpper && o.id !== offer?.id) ? 'Another offer uses this code.' : undefined,
    discount_value: type === 'none' ? undefined
      : !value.trim() || !Number.isFinite(valueNum) || valueNum <= 0 ? 'Enter the discount.'
        : type === 'percent' && valueNum > 100 ? "Can't be more than 100%." : valueNum > 1_000_000 ? 'Too large.' : undefined,
    extra_days: !Number.isFinite(extraNum) || extraNum > 730 ? '0–730 days.' : type === 'none' && extraNum === 0 ? 'Give a discount or extra free days.' : undefined,
    min_months: !Number.isFinite(minNum) || minNum < 1 || minNum > 60 ? '1–60 months.' : undefined,
    starts_at: start.trim() && !startIso ? 'Use YYYY-MM-DD.' : undefined,
    ends_at: end.trim() && !endIso ? 'Use YYYY-MM-DD.' : startIso && endIso && end < start ? 'Must be on or after the start date.' : undefined,
    max_redemptions: maxUses.trim() && (!/^\d+$/.test(maxUses.trim()) || Number(maxUses) < 1) ? 'A whole number, 1 or more (empty = no limit).' : undefined,
  };
  const show = (k: string) => serverErrors[k] || (submitted ? errors[k] : undefined);

  const summary = previewSummary(type, type === 'none' ? 0 : valueNum || 0, Number.isFinite(extraNum) ? extraNum : 0, Number.isFinite(minNum) ? minNum : 1, planKeys, plans);

  // Worked example on a real plan price, so the admin sees what an owner would pay
  const example = useMemo(() => {
    const candidates = plans.filter((p) => p.is_active && p.price_monthly > 0 && (!planKeys.length || planKeys.includes(p.key)));
    for (const p of candidates) {
      const opt = [...p.price_options].reverse().find((x) => x.months >= (Number.isFinite(minNum) ? minNum : 1));
      if (!opt) continue;
      const discount = type === 'percent' ? Math.round(opt.price * Math.min(valueNum || 0, 100)) / 100 : type === 'flat' ? Math.min(valueNum || 0, opt.price) : 0;
      return { plan: p.name, label: opt.label, price: opt.price, pay: Math.max(0, Math.round((opt.price - discount) * 100) / 100), days: Number.isFinite(extraNum) ? extraNum : 0 };
    }
    return null;
  }, [plans, planKeys, minNum, type, valueNum, extraNum]);

  const togglePlan = (key: string) => setPlanKeys((s) => (s.includes(key) ? s.filter((k) => k !== key) : [...s, key]));

  const submit = async () => {
    setSubmitted(true);
    setFormError(null);
    if (Object.values(errors).some(Boolean)) return;
    const body: SubscriptionOfferBody = {
      name: name.trim(), description: description.trim() || null, code: codeUpper || null, discount_type: type,
      discount_value: type === 'none' ? 0 : valueNum, extra_days: extraNum, plan_keys: planKeys.length ? planKeys : null, min_months: minNum,
      starts_at: start === startOriginal && offer ? offer.starts_at : startIso,
      // The last day is inclusive: the offer ends at the next midnight in India
      ends_at: end === endOriginal && offer ? offer.ends_at : endIso ? new Date(new Date(endIso).getTime() + 86_400_000).toISOString() : null,
      max_redemptions: maxNum, new_businesses_only: newOnly, show_to_owners: showOwners, is_active: active,
    };
    setSaving(true);
    try {
      const saved = isNew ? await platformApi.createSubscriptionOffer(body) : await platformApi.updateSubscriptionOffer(offer!.id, body);
      toast.success(isNew ? `${saved.name} created` : `${saved.name} saved`);
      onSaved(saved);
    } catch (e) {
      setServerErrors(fieldErrorsFrom(e));
      setFormError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet visible onClose={onClose} title={isNew ? 'New subscription offer' : `Edit ${offer!.name}`}
      subtitle={offer ? `${plural(offer.redemptions, 'redemption')} so far` : 'A promotion on Tallyko plans.'} width={720}
      footer={
        <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'flex-end' }}>
          <Button title="Cancel" variant="secondary" onPress={onClose} disabled={saving} />
          <Button title={isNew ? 'Create offer' : 'Save offer'} icon="checkmark" onPress={submit} loading={saving} disabled={!online} />
        </View>
      }>
      {formError ? <Callout tone="danger">{formError}</Callout> : null}
      {!online ? <Callout tone="warning">You're offline. Connect to save the offer.</Callout> : null}

      <Card style={{ gap: 6 }}>
        <Text variant="caption" tone="subtle">PREVIEW</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Text variant="h3">{name.trim() || 'Offer name'}</Text>
          {codeUpper ? <Badge label={codeUpper} tone="primary" icon="pricetag-outline" /> : null}
        </View>
        <Text variant="bodyStrong" tone={summary ? 'primary' : 'subtle'}>{summary || 'Choose a discount or extra free days.'}</Text>
        {example ? (
          <Text variant="small" tone="muted">
            {`e.g. ${example.plan} · ${example.label}: ${money(example.price, '₹', true)} → ${money(example.pay)}${example.days ? ` + ${example.days} days free` : ''}`}
          </Text>
        ) : null}
        <Text variant="small" tone="subtle">
          {[start.trim() && startIso ? `from ${dayText(start.trim())}` : 'from now', end.trim() && endIso ? `last day ${dayText(end.trim())}` : 'no end date',
            maxNum ? `max ${maxNum} uses` : null, newOnly ? 'first paid subscription only' : null].filter(Boolean).join(' · ')}
        </Text>
      </Card>

      <FieldRow>
        <Input label="Offer name" required value={name} onChangeText={setName} maxLength={80} error={show('name')} placeholder="e.g. Diwali offer" autoFocus={isNew} />
        <Input label="Code" value={code} onChangeText={(v) => setCode(v.toUpperCase().replace(/[^A-Z0-9_-]/g, ''))} maxLength={30} error={show('code')}
          autoCapitalize="characters" autoCorrect={false} placeholder="DIWALI25" hint="Owners type this when they renew." />
      </FieldRow>
      <Input label="Description" value={description} onChangeText={setDescription} maxLength={300} placeholder="e.g. 25% off any yearly plan" />

      <View style={{ gap: 6 }}>
        <Text variant="smallStrong" tone="muted">Discount</Text>
        <View style={{ maxWidth: 420 }}>
          <Segmented value={type} options={DISCOUNT_TYPES} onChange={(t) => { setType(t); if (t === 'none') setValue(''); }} />
        </View>
        {type !== 'none' ? (
          <Input value={value} onChangeText={(v) => setValue(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" maxLength={10}
            prefix={type === 'flat' ? '₹' : undefined} right={type === 'percent' ? <Text tone="muted" style={{ marginRight: 12 }}>%</Text> : undefined}
            containerStyle={{ maxWidth: 220 }} accessibilityLabel="Discount value" error={show('discount_value')} placeholder={type === 'percent' ? '25' : '500'} />
        ) : null}
      </View>

      <View style={{ gap: 6 }}>
        <Text variant="smallStrong" tone="muted">Extra free days</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'flex-start' }}>
          <ChoiceChips value={Number.isFinite(extraNum) && EXTRA_DAY_CHOICES.includes(extraNum) ? String(extraNum) : ''} onChange={setExtra} accessibilityLabel="Extra free days"
            options={EXTRA_DAY_CHOICES.map((d) => ({ value: String(d), label: d === 0 ? 'None' : `${d} days` }))} />
          <Input value={extra} onChangeText={(v) => setExtra(v.replace(/[^0-9]/g, ''))} keyboardType="number-pad" maxLength={3}
            containerStyle={{ width: 90 }} accessibilityLabel="Extra free days" error={show('extra_days') ? ' ' : undefined} />
        </View>
        {show('extra_days') ? <Text variant="small" tone="danger">{show('extra_days')}</Text> : <Text variant="small" tone="subtle">Added on top of the months paid for.</Text>}
      </View>

      <View style={{ gap: 6 }}>
        <Text variant="smallStrong" tone="muted">Plans</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Chip label="All plans" selected={planKeys.length === 0} onPress={() => setPlanKeys([])} />
          {plans.filter((p) => p.is_active || planKeys.includes(p.key)).map((p) => (
            <Chip key={p.key} label={p.name} selected={planKeys.includes(p.key)} onPress={() => togglePlan(p.key)} icon={planKeys.includes(p.key) ? 'checkmark' : undefined} />
          ))}
        </View>
      </View>

      <View style={{ gap: 6 }}>
        <Text variant="smallStrong" tone="muted">Minimum duration</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'flex-start' }}>
          <ChoiceChips value={Number.isFinite(minNum) && MIN_MONTH_CHOICES.includes(minNum) ? String(minNum) : ''} onChange={setMinMonths} accessibilityLabel="Minimum months"
            options={MIN_MONTH_CHOICES.map((m) => ({ value: String(m), label: m === 1 ? 'Any' : m === 12 ? '1 year+' : `${m} months+` }))} />
          <Input value={minMonths} onChangeText={(v) => setMinMonths(v.replace(/[^0-9]/g, ''))} keyboardType="number-pad" maxLength={2}
            containerStyle={{ width: 90 }} accessibilityLabel="Minimum months" error={show('min_months') ? ' ' : undefined} />
        </View>
        {show('min_months') ? <Text variant="small" tone="danger">{show('min_months')}</Text> : null}
      </View>

      <FieldRow>
        <Input label="Starts on" value={start} onChangeText={setStart} maxLength={10} placeholder={istDate()} error={show('starts_at')}
          hint="YYYY-MM-DD, India time. Empty = now." autoCapitalize="none" />
        <Input label="Last day" value={end} onChangeText={setEnd} maxLength={10} placeholder={istDate(30)} error={show('ends_at')}
          hint="Inclusive. Empty = no end date." autoCapitalize="none"
          right={end ? <Button icon="close" size="sm" variant="ghost" accessibilityLabel="Clear last day" onPress={() => setEnd('')} /> : undefined} />
      </FieldRow>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {[7, 15, 30, 60].map((d) => (
          <Button key={d} title={`Ends in ${d} days`} size="sm" variant={end === istDate(d) ? 'soft' : 'secondary'} onPress={() => setEnd(istDate(d))} />
        ))}
      </View>

      <Input label="Maximum uses" value={maxUses} onChangeText={(v) => setMaxUses(v.replace(/[^0-9]/g, ''))} keyboardType="number-pad" maxLength={7}
        placeholder="No limit" error={show('max_redemptions')} containerStyle={{ maxWidth: 260 }}
        hint={offer?.redemptions ? `Used ${offer.redemptions} time${offer.redemptions === 1 ? '' : 's'} so far.` : 'Across all businesses. Empty = no limit.'} />

      <View style={{ gap: 4 }}>
        <SettingSwitch title="First paid subscription only" value={newOnly} onValueChange={setNewOnly}
          subtitle="For businesses that have never paid (demos and new sign-ups)." />
        <SettingSwitch title="Show to owners on the renewal page" value={showOwners} onValueChange={setShowOwners}
          subtitle={showOwners ? 'Owners see it with its code.' : 'Hidden: only people you give the code to can use it.'} />
        <SettingSwitch title="Active" value={active} onValueChange={setActive}
          subtitle={active ? 'Can be used within its dates.' : 'Paused: nobody can use it.'} />
      </View>
    </Sheet>
  );
}
