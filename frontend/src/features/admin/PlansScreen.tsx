/** Plans: price per month, included features and limits. Editing a plan changes every business on it (minus their overrides). */
import React, { useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { errorMessage } from '@/api/client';
import { LIMIT_KEYS, platformApi, type BillingOption, type FeatureInfo, type LimitKey, type Limits, type PlanInfo, type PlansResponse } from '@/api/platform';
import { Badge, Button, Card, Divider, EmptyState, ErrorState, Input, Loading, Sheet, Text, toast } from '@/components/ui';
import { useApi } from '@/hooks/useApi';
import { money } from '@/lib/format';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import { Callout, FieldRow, SettingSwitch, monoFont } from '@/features/settings/components';
import { fieldErrorsFrom } from '@/features/settings/validation';
import { AdminPage, LIMIT_LABEL, ReadOnlyNote, goTo, limitText, useCanEdit, useOnline } from './shared';

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export default function PlansScreen() {
  const { width } = useLayout();
  const canEdit = useCanEdit();
  const { data, error, loading, refreshing, reload, setData } = useApi(() => platformApi.plans(), []);
  const [editing, setEditing] = useState<PlanInfo | 'new' | null>(null);
  const columns = width >= 1500 ? 3 : width >= 900 ? 2 : 1;
  const plans = data?.plans ?? [];

  return (
    <AdminPage
      title="Plans & features"
      subtitle="What each plan costs and includes. Changes apply to every business on the plan straight away; per-business overrides still win."
      refreshing={refreshing}
      onRefresh={reload}
      actions={canEdit ? <Button title="New plan" icon="add" onPress={() => setEditing('new')} /> : null}
    >
      {!canEdit ? <ReadOnlyNote what="edit plans" /> : null}
      {loading && !data ? <Loading label="Loading plans" /> : null}
      {error && !data ? <ErrorState message={error} onRetry={reload} /> : null}
      {data && plans.length === 0 ? (
        <EmptyState icon="layers-outline" title="No plans" message="Create the first plan to choose what businesses get."
          action={canEdit ? { label: 'New plan', icon: 'add', onPress: () => setEditing('new') } : undefined} />
      ) : null}

      {plans.length ? (
        <View style={{ gap: 16 }}>
          {chunk(plans, columns).map((row) => (
            <View key={row.map((p) => p.key).join()} style={{ flexDirection: 'row', gap: 16, alignItems: 'stretch' }}>
              {row.map((p) => (
                <View key={p.key} style={{ flex: 1, minWidth: 0 }}>
                  <PlanCard plan={p} catalog={data!.features} canEdit={canEdit} onEdit={() => setEditing(p)} />
                </View>
              ))}
              {Array.from({ length: columns - row.length }, (_, i) => <View key={`pad-${i}`} style={{ flex: 1 }} />)}
            </View>
          ))}
        </View>
      ) : null}

      {data ? (
        <Callout tone="neutral" icon="information-circle-outline">
          Payments keep a snapshot of the plan they paid for, so editing a plan never changes what was sold. A business can have extra features switched on or off on its own page.
        </Callout>
      ) : null}

      {editing && data ? (
        <PlanSheet plan={editing === 'new' ? null : editing} data={data} onClose={() => setEditing(null)}
          onSaved={(next) => { setData(next); setEditing(null); }} />
      ) : null}
    </AdminPage>
  );
}

function PlanCard({ plan: p, catalog, canEdit, onEdit }: { plan: PlanInfo; catalog: FeatureInfo[]; canEdit: boolean; onEdit: () => void }) {
  const { colors } = useTheme();
  const included = new Set(p.features);
  return (
    <Card style={{ gap: 12, flex: 1 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Text variant="h2">{p.name}</Text>
            {!p.is_active ? <Badge label="Not offered" tone="warning" /> : null}
          </View>
          <Text variant="caption" tone="subtle" style={{ fontFamily: monoFont }}>{p.key}</Text>
        </View>
        {canEdit ? <Button title="Edit" icon="create-outline" size="sm" variant="secondary" onPress={onEdit} /> : null}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
        <Text variant="moneyLarge">{p.price_monthly ? money(p.price_monthly, '₹', true) : 'Free'}</Text>
        {p.price_monthly ? <Text tone="muted">/ month</Text> : null}
      </View>
      {p.description ? <Text variant="small" tone="muted">{p.description}</Text> : null}
      {p.price_monthly && p.price_options?.length ? (
        <View style={{ gap: 4 }}>
          {p.price_options.map((o) => (
            <View key={o.months} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text variant="small" style={{ flex: 1 }} numberOfLines={1}>{o.label}</Text>
              {o.saving > 0 ? <Badge label={`Save ${money(o.saving, '₹', true)}`} tone="success" /> : null}
              <Text variant="smallStrong">{money(o.price, '₹', true)}</Text>
            </View>
          ))}
        </View>
      ) : null}
      <Pressable onPress={() => goTo(`/admin/businesses?plan=${encodeURIComponent(p.key)}`)} accessibilityRole="link"
        accessibilityLabel={`${p.businesses} businesses on ${p.name}`}
        style={({ hovered }: any) => [{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' }, hovered && { opacity: 0.75 },
          Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}>
        <Ionicons name="storefront-outline" size={16} color={colors.primary} />
        <Text variant="smallStrong" tone="primary">{p.businesses.toLocaleString('en-IN')} business{p.businesses === 1 ? '' : 'es'}</Text>
      </Pressable>
      <Divider />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {LIMIT_KEYS.map((k) => (
          <View key={k} style={{ flex: 1, gap: 2 }}>
            <Text variant="caption" tone="subtle" numberOfLines={1}>{LIMIT_LABEL[k].toUpperCase()}</Text>
            <Text variant="bodyStrong">{limitText(p.limits[k])}</Text>
          </View>
        ))}
      </View>
      <Divider />
      <Text variant="smallStrong" tone="muted">{p.features.length} of {catalog.length} features</Text>
      <View style={{ gap: 6 }}>
        {catalog.map((f) => {
          const on = included.has(f.key);
          return (
            <View key={f.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name={on ? 'checkmark-circle' : 'remove-circle-outline'} size={16} color={on ? colors.success : colors.textSubtle} />
              <Text variant="small" tone={on ? 'default' : 'subtle'} style={{ flex: 1 }} numberOfLines={1}>{f.name}</Text>
            </View>
          );
        })}
      </View>
    </Card>
  );
}

function Checkbox({ label, checked, onToggle, disabled }: { label: string; checked: boolean; onToggle: () => void; disabled?: boolean }) {
  const { colors, radius } = useTheme();
  return (
    <Pressable onPress={onToggle} disabled={disabled} accessibilityRole="checkbox" accessibilityState={{ checked, disabled }} accessibilityLabel={label}
      style={({ hovered }: any) => [
        { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, paddingHorizontal: 10, borderRadius: radius.md },
        hovered && { backgroundColor: colors.surfaceSunken },
        Platform.OS === 'web' && ({ cursor: 'pointer' } as any),
      ]}>
      <Ionicons name={checked ? 'checkbox' : 'square-outline'} size={22} color={checked ? colors.primary : colors.textSubtle} />
      <Text variant="body" style={{ flex: 1 }}>{label}</Text>
    </Pressable>
  );
}

function PlanSheet({ plan, data, onClose, onSaved }: { plan: PlanInfo | null; data: PlansResponse; onClose: () => void; onSaved: (next: PlansResponse) => void }) {
  const online = useOnline();
  const { isPhone } = useLayout();
  const isNew = !plan;
  const [key, setKey] = useState(plan?.key ?? '');
  const [name, setName] = useState(plan?.name ?? '');
  const [description, setDescription] = useState(plan?.description ?? '');
  const [price, setPrice] = useState(plan ? String(plan.price_monthly) : '');
  const [features, setFeatures] = useState<Set<string>>(new Set(plan?.features ?? []));
  const [limits, setLimits] = useState<Record<LimitKey, string>>(() => {
    const out = {} as Record<LimitKey, string>;
    for (const k of LIMIT_KEYS) out[k] = plan?.limits[k] === null || plan?.limits[k] === undefined ? '' : String(plan.limits[k]);
    return out;
  });
  const [active, setActive] = useState(plan?.is_active ?? true);
  const [billing, setBilling] = useState<BillingRow[]>(() => (plan?.billing_options ?? []).map((o) => ({
    months: String(o.months), price: o.price === null || o.price === undefined ? '' : String(o.price), label: o.label ?? '',
  })));
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const priceNum = Number(price.trim());
  const errors: Record<string, string | undefined> = {
    key: !isNew ? undefined : !/^[a-z0-9_]{2,40}$/.test(key) ? 'Lowercase letters, digits and _ (2–40).' : data.plans.some((p) => p.key === key) ? 'A plan with this key exists.' : undefined,
    name: name.trim().length < 2 ? 'At least 2 characters.' : undefined,
    price_monthly: price.trim() === '' || !Number.isFinite(priceNum) || priceNum < 0 ? 'Enter a price (0 for free).' : priceNum > 1_000_000 ? 'Too large.' : undefined,
    ...Object.fromEntries(LIMIT_KEYS.map((k) => [k, limits[k].trim() && !/^\d+$/.test(limits[k].trim()) ? 'Whole number, or empty for unlimited.' : undefined])),
    billing: billingError(billing),
  };
  const show = (k: string) => serverErrors[k] || (submitted ? errors[k] : undefined);

  const toggle = (f: string) => setFeatures((s) => {
    const next = new Set(s);
    if (next.has(f)) next.delete(f);
    else next.add(f);
    return next;
  });

  const submit = async () => {
    setSubmitted(true);
    setFormError(null);
    if (Object.values(errors).some(Boolean)) return;
    const lim: Limits = {};
    for (const k of LIMIT_KEYS) lim[k] = limits[k].trim() ? Number(limits[k].trim()) : null;
    setSaving(true);
    try {
      const next = await platformApi.savePlan({
        key: isNew ? key : plan!.key, name: name.trim(), description: description.trim() || null, price_monthly: priceNum,
        features: [...features], limits: lim, is_active: active,
        // Always sent: leaving it out would clear the plan's billing options
        billing_options: billing.map((r): BillingOption => ({ months: Number(r.months.trim()), price: r.price.trim() ? Number(r.price.trim()) : null, label: r.label.trim() || null })),
        sort_order: plan?.sort_order ?? Math.max(0, ...data.plans.map((p) => p.sort_order)) + 1,
      });
      toast.success(isNew ? `${name.trim()} plan created` : `${name.trim()} plan saved`);
      onSaved(next);
    } catch (e) {
      setServerErrors(fieldErrorsFrom(e));
      setFormError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const removed = plan ? plan.features.filter((f) => !features.has(f)) : [];

  return (
    <Sheet visible onClose={onClose} title={isNew ? 'New plan' : `Edit ${plan!.name}`}
      subtitle={plan ? `${plan.businesses} business${plan.businesses === 1 ? '' : 'es'} on this plan` : 'Choose what businesses on this plan get.'} width={720}
      footer={
        <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'flex-end' }}>
          <Button title="Cancel" variant="secondary" onPress={onClose} disabled={saving} />
          <Button title={isNew ? 'Create plan' : 'Save plan'} icon="checkmark" onPress={submit} loading={saving} disabled={!online} />
        </View>
      }>
      {formError ? <Callout tone="danger">{formError}</Callout> : null}
      {!online ? <Callout tone="warning">You're offline. Connect to save the plan.</Callout> : null}
      <FieldRow>
        <Input label="Plan name" required value={name} onChangeText={setName} maxLength={60} error={show('name')} placeholder="e.g. Growth" autoFocus={isNew} />
        <Input label="Price per month" required prefix="₹" value={price} onChangeText={(v) => setPrice(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad"
          maxLength={10} error={show('price_monthly')} placeholder="0" hint="Before GST. 0 = free." />
      </FieldRow>
      {isNew ? (
        <Input label="Key" required value={key} onChangeText={(v) => setKey(v.toLowerCase().replace(/[^a-z0-9_]/g, ''))} maxLength={40} error={show('key')}
          autoCapitalize="none" autoCorrect={false} placeholder="growth" hint="Permanent id used by the system; can't be changed later." />
      ) : null}
      <Input label="Description" value={description} onChangeText={setDescription} maxLength={300} placeholder="Who is this plan for?" />

      <View style={{ gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text variant="smallStrong" tone="muted" style={{ flex: 1 }}>Features ({features.size} of {data.features.length})</Text>
          <Button title="All" size="sm" variant="ghost" onPress={() => setFeatures(new Set(data.features.map((f) => f.key)))} />
          <Button title="None" size="sm" variant="ghost" onPress={() => setFeatures(new Set())} />
        </View>
        <Card padded={false} style={{ paddingVertical: 4 }}>
          <View style={{ flexDirection: isPhone ? 'column' : 'row', flexWrap: 'wrap' }}>
            {data.features.map((f) => (
              <View key={f.key} style={{ width: isPhone ? '100%' : '50%' }}>
                <Checkbox label={f.name} checked={features.has(f.key)} onToggle={() => toggle(f.key)} />
              </View>
            ))}
          </View>
        </Card>
        {removed.length && plan?.businesses ? (
          <Callout tone="warning">
            {`Removing ${removed.length} feature${removed.length === 1 ? '' : 's'} switches ${removed.length === 1 ? 'it' : 'them'} off for ${plan.businesses} business${plan.businesses === 1 ? '' : 'es'} right away (unless overridden on the business).`}
          </Callout>
        ) : null}
      </View>

      <View style={{ gap: 6 }}>
        <Text variant="smallStrong" tone="muted">Limits (leave empty for unlimited)</Text>
        <FieldRow>
          {LIMIT_KEYS.map((k) => (
            <Input key={k} label={LIMIT_LABEL[k]} value={limits[k]} onChangeText={(v) => setLimits((s) => ({ ...s, [k]: v.replace(/[^0-9]/g, '') }))}
              keyboardType="number-pad" maxLength={7} placeholder="Unlimited" error={show(k)} />
          ))}
        </FieldRow>
      </View>

      <BillingOptionsEditor rows={billing} onChange={setBilling} monthly={Number.isFinite(priceNum) ? priceNum : 0} error={submitted ? errors.billing : undefined} />

      <SettingSwitch title="Offered to new businesses" value={active} onValueChange={setActive}
        subtitle={active ? 'Shown when onboarding businesses and recording payments.' : 'Hidden from new sign-ups; existing businesses keep it.'} />
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Billing options (how a plan can be bought: monthly, quarterly, yearly with a saving...)
// ---------------------------------------------------------------------------

interface BillingRow { months: string; price: string; label: string }

function billingError(rows: BillingRow[]): string | undefined {
  const seen = new Set<number>();
  for (const r of rows) {
    const m = r.months.trim();
    if (!/^\d+$/.test(m) || Number(m) < 1 || Number(m) > 60) return 'Each option needs 1–60 months.';
    if (seen.has(Number(m))) return `${m} months is listed twice.`;
    seen.add(Number(m));
    const p = r.price.trim();
    if (p && (!Number.isFinite(Number(p)) || Number(p) < 0 || Number(p) > 10_000_000)) return 'Prices must be 0 or more (empty = monthly × months).';
  }
  return undefined;
}

function defaultLabel(months: number): string {
  return ({ 1: 'Monthly', 3: 'Quarterly', 6: 'Half-yearly', 12: 'Yearly' } as Record<number, string>)[months] ?? `${months} months`;
}

function BillingOptionsEditor({ rows, onChange, monthly, error }: { rows: BillingRow[]; onChange: (rows: BillingRow[]) => void; monthly: number; error?: string }) {
  const { isPhone } = useLayout();
  const set = (i: number, patch: Partial<BillingRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const add = () => {
    const used = new Set(rows.map((r) => Number(r.months)));
    const next = [1, 3, 6, 12, 24].find((m) => !used.has(m)) ?? 1;
    onChange([...rows, { months: String(next), price: '', label: '' }]);
  };
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <View style={{ flex: 1, minWidth: 200 }}>
          <Text variant="smallStrong" tone="muted">Billing options</Text>
          <Text variant="small" tone="subtle">
            {rows.length ? 'Owners and the payment sheet offer exactly these durations.' : 'None set: monthly price × 1, 3, 6 or 12 months, no saving.'}
          </Text>
        </View>
        {!rows.length && monthly > 0 ? (
          <Button title="Use 1 / 3 / 12" size="sm" variant="ghost"
            onPress={() => onChange([{ months: '1', price: '', label: '' }, { months: '3', price: '', label: '' }, { months: '12', price: String(Math.round(monthly * 10)), label: 'Yearly · 2 months free' }])} />
        ) : null}
        <Button title="Add option" icon="add" size="sm" variant="secondary" onPress={add} disabled={rows.length >= 8} />
      </View>
      {rows.length ? (
        <Card padded={false} style={{ paddingVertical: 4 }}>
          {rows.map((r, i) => {
            const m = /^\d+$/.test(r.months.trim()) ? Number(r.months.trim()) : 0;
            const full = monthly * m;
            const price = r.price.trim() ? Number(r.price.trim()) : full;
            const per = m ? price / m : 0;
            const saving = Math.max(0, Math.round((full - price) * 100) / 100);
            const pct = full > 0 ? Math.round((saving / full) * 100) : 0;
            return (
              <View key={i}>
                {i > 0 ? <Divider /> : null}
                <View style={{ flexDirection: isPhone ? 'column' : 'row', gap: 8, padding: 10, alignItems: isPhone ? 'stretch' : 'flex-start' }}>
                  <View style={{ flexDirection: 'row', gap: 8, flex: isPhone ? undefined : 1.4 }}>
                    <Input label="Months" value={r.months} onChangeText={(v) => set(i, { months: v.replace(/[^0-9]/g, '') })} keyboardType="number-pad" maxLength={2}
                      containerStyle={{ width: 80 }} />
                    <Input label="Price" prefix="₹" value={r.price} onChangeText={(v) => set(i, { price: v.replace(/[^0-9.]/g, '') })} keyboardType="decimal-pad" maxLength={10}
                      placeholder={full ? String(Math.round(full * 100) / 100) : 'Auto'} containerStyle={{ flex: 1 }} />
                  </View>
                  <Input label="Label" value={r.label} onChangeText={(label) => set(i, { label })} maxLength={40} placeholder={m ? defaultLabel(m) : 'Label'}
                    containerStyle={{ flex: isPhone ? undefined : 1.3 }} />
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: isPhone ? undefined : 1, paddingTop: isPhone ? 0 : 26 }}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text variant="smallStrong" numberOfLines={1}>{m ? `${money(per, '₹', true)}/mo` : '—'}</Text>
                      {saving > 0 ? <Text variant="caption" tone="success" numberOfLines={1}>{`Save ${money(saving, '₹', true)} (${pct}%)`}</Text>
                        : price > full && m ? <Text variant="caption" tone="warning" numberOfLines={1}>Above the monthly rate</Text>
                          : <Text variant="caption" tone="subtle" numberOfLines={1}>No saving</Text>}
                    </View>
                    <Button icon="trash-outline" size="sm" variant="ghost" accessibilityLabel={`Remove the ${m || ''} month option`} onPress={() => onChange(rows.filter((_, j) => j !== i))} />
                  </View>
                </View>
              </View>
            );
          })}
        </Card>
      ) : null}
      {error ? <Text variant="small" tone="danger">{error}</Text> : null}
    </View>
  );
}
