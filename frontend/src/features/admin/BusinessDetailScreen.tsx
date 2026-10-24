/**
 * One business: owner contact, status (suspend / reactivate), access (demo / development / locked), signed-in devices,
 * plan + per-feature overrides + limits, admin notes, owner password reset, payment history and "Record payment".
 */
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { errorMessage } from '@/api/client';
import {
  LIMIT_KEYS, platformApi,
  type AuditEntry, type BusinessDetail, type BusinessUpdateBody, type LimitKey, type Limits, type PlanInfo,
} from '@/api/platform';
import { Badge, Button, Card, Divider, EmptyState, ErrorState, Input, Loading, Segmented, Sheet, Text, confirm, toast } from '@/components/ui';
import { useApi } from '@/hooks/useApi';
import { ago, formatDateTime } from '@/lib/format';
import { useLayout } from '@/theme/ThemeProvider';
import { Callout, ChoiceChips, KeyValue, SaveBar, copyText } from '@/features/settings/components';
import { AccessCard, DevicesCard, PaymentsCard, RecordPaymentSheet } from './BusinessAccess';
import { RecordsCard } from './BusinessRecords';
import { CredentialsSheet } from './OnboardBusinessSheet';
import {
  AccessBadge, AdminPage, BUSINESS_TYPE_LABEL, LIMIT_LABEL, PlanBadge, ReadOnlyNote, StatusBadge,
  accessDaysText, actionLabel, limitText, shortDate, useCanEdit, useOnline,
} from './shared';

type FeatureMode = 'default' | 'on' | 'off';
type LimitMode = 'plan' | 'custom' | 'unlimited';
interface LimitDraft { mode: LimitMode; value: string }
interface Draft {
  planKey: string;
  features: Record<string, boolean>;
  limits: Record<LimitKey, LimitDraft>;
  notes: string;
}

function draftFrom(b: BusinessDetail): Draft {
  const limits = {} as Record<LimitKey, LimitDraft>;
  for (const key of LIMIT_KEYS) {
    const has = Object.prototype.hasOwnProperty.call(b.limit_overrides ?? {}, key);
    const v = b.limit_overrides?.[key];
    limits[key] = !has ? { mode: 'plan', value: '' } : v === null || v === undefined ? { mode: 'unlimited', value: '' } : { mode: 'custom', value: String(v) };
  }
  return { planKey: b.plan_key, features: { ...(b.feature_overrides ?? {}) }, limits, notes: b.admin_notes ?? '' };
}

function sameDraft(a: Draft, b: Draft): boolean {
  return JSON.stringify(normalise(a)) === JSON.stringify(normalise(b));
}

function normalise(d: Draft) {
  return {
    planKey: d.planKey,
    features: Object.keys(d.features).sort().map((k) => [k, d.features[k]]),
    limits: LIMIT_KEYS.map((k) => [k, d.limits[k].mode, d.limits[k].mode === 'custom' ? d.limits[k].value.trim() : '']),
    notes: d.notes.trim(),
  };
}

function limitError(l: LimitDraft): string | undefined {
  if (l.mode !== 'custom') return undefined;
  const v = l.value.trim();
  if (!/^\d+$/.test(v)) return 'Enter a whole number.';
  if (Number(v) > 1_000_000) return 'Too large.';
  return undefined;
}

export default function BusinessDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <BusinessDetailView businessId={String(id ?? '')} />;
}

/**
 * The business page. As a desktop side panel (`onClose` set) it stacks in one column next to the businesses list,
 * and the list stays visible.
 */
export function BusinessDetailView({ businessId, onClose, onChanged }: { businessId: string; onClose?: () => void; onChanged?: () => void }) {
  const panel = !!onClose;
  const { width } = useLayout();
  const canEditRole = useCanEdit();
  const online = useOnline();
  const detail = useApi(() => platformApi.business(businessId), [businessId]);
  const plans = useApi(() => platformApi.plans(), []);
  const activity = useApi(() => platformApi.audit({ business_id: businessId, limit: 20 }), [businessId]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [sheet, setSheet] = useState<null | 'suspend' | 'payment' | { email: string; password: string }>(null);
  const [busy, setBusy] = useState<null | 'reactivate' | 'reset'>(null);

  const b = detail.data;
  const baseline = useMemo(() => (b ? draftFrom(b) : null), [b]);
  const form = draft ?? baseline;
  const dirty = !!(draft && baseline && !sameDraft(draft, baseline));
  const closed = b?.status === 'deleted';
  const editable = canEditRole && !closed;
  const twoCol = !panel && width >= 1240;

  const edit = (patch: Partial<Draft>) => {
    if (!form) return;
    setDraft({ ...form, ...patch });
  };

  const goBack = async () => {
    if (dirty && !(await confirm({ title: 'Discard unsaved changes?', message: 'You changed this business but did not save.', confirmLabel: 'Discard', danger: true }))) return;
    if (onClose) { onClose(); return; }
    if (router.canGoBack()) router.back();
    else router.replace('/admin/businesses' as Href);
  };

  const reloadAll = () => {
    void detail.reload();
    void plans.reload();
    void activity.reload();
  };

  const applyDetail = (next: BusinessDetail) => {
    detail.setData(next);
    onChanged?.();
    void activity.silentReload();
  };

  const limitErrors = form ? LIMIT_KEYS.map((k) => limitError(form.limits[k])).filter(Boolean) : [];

  const save = async () => {
    if (!b || !form || !baseline) return;
    if (limitErrors.length) {
      toast.error('Fix the limits before saving.');
      return;
    }
    const body: BusinessUpdateBody = {};
    if (form.planKey !== baseline.planKey) body.plan_key = form.planKey;
    if (JSON.stringify(normalise(form).features) !== JSON.stringify(normalise(baseline).features)) body.feature_overrides = form.features;
    if (JSON.stringify(normalise(form).limits) !== JSON.stringify(normalise(baseline).limits)) {
      const limits: Limits = {};
      for (const k of LIMIT_KEYS) {
        const l = form.limits[k];
        if (l.mode === 'unlimited') limits[k] = null;
        else if (l.mode === 'custom') limits[k] = Number(l.value.trim());
      }
      body.limit_overrides = limits;
    }
    if (form.notes.trim() !== baseline.notes.trim()) body.admin_notes = form.notes.trim() || null;
    setSaving(true);
    try {
      const next = await platformApi.updateBusiness(b.id, body);
      applyDetail(next);
      setDraft(null);
      toast.success('Business updated');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const reactivate = async () => {
    if (!b) return;
    const ok = await confirm({ title: `Reactivate ${b.name}?`, message: 'The owner and staff can sign in and bill again straight away.', confirmLabel: 'Reactivate' });
    if (!ok) return;
    setBusy('reactivate');
    try {
      applyDetail(await platformApi.updateBusiness(b.id, { status: 'active', status_reason: null }));
      toast.success(`${b.name} is active again`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const resetPassword = async () => {
    if (!b) return;
    const ok = await confirm({
      title: 'Reset the owner password?',
      message: `${b.owner.email ?? 'The owner'} gets a new temporary password; the old one stops working. Share the new one privately.`,
      confirmLabel: 'Reset password', danger: true,
    });
    if (!ok) return;
    setBusy('reset');
    try {
      const r = await platformApi.resetOwnerPassword(b.id);
      setSheet({ email: r.owner_email, password: r.temporary_password });
      void activity.silentReload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  if (!b || !form) {
    return (
      <AdminPage title="Business" back={{ label: panel ? 'Close' : 'All businesses', onPress: goBack }}>
        {detail.loading ? <Loading label="Loading business" /> : null}
        {detail.error && !detail.loading ? <ErrorState message={detail.error} onRetry={detail.reload} /> : null}
      </AdminPage>
    );
  }

  const planList = plans.data?.plans ?? [];
  const selectedPlan = planList.find((p) => p.key === form.planKey) ?? null;
  const currentPlanName = planList.find((p) => p.key === b.plan_key)?.name ?? b.plan_key;

  const statusCard = <StatusCard business={b} editable={editable} online={online} busy={busy === 'reactivate'} onSuspend={() => setSheet('suspend')} onReactivate={reactivate} />;
  const ownerCard = <OwnerCard business={b} editable={editable} online={online} resetting={busy === 'reset'} onReset={resetPassword} />;
  const paymentsCard = <PaymentsCard business={b} planName={currentPlanName} editable={editable} online={online} onRecord={() => setSheet('payment')} />;
  const accessCard = (
    <AccessCard business={b} editable={editable} online={online} onRecordPayment={() => setSheet('payment')}
      onChanged={(next) => { if (next) applyDetail(next); else { void detail.silentReload(); void activity.silentReload(); } }} />
  );
  const devicesCard = <DevicesCard business={b} editable={canEditRole && !closed} />;
  // Records stay correctable after the owner closes the business (the owner may ask Tallyko to remove data)
  const recordsCard = <RecordsCard businessId={b.id} businessName={b.name} editable={canEditRole} />;
  const planCard = (
    <PlanFeaturesCard business={b} form={form} plans={planList} plansError={plans.error} selectedPlan={selectedPlan} editable={editable}
      onPlan={(planKey) => edit({ planKey })}
      onFeature={(key, mode) => {
        const features = { ...form.features };
        if (mode === 'default') delete features[key];
        else features[key] = mode === 'on';
        edit({ features });
      }} />
  );
  const limitsCard = (
    <LimitsCard business={b} form={form} selectedPlan={selectedPlan} editable={editable}
      onLimit={(key, l) => edit({ limits: { ...form.limits, [key]: l } })} />
  );
  const notesCard = (
    <Card style={{ gap: 10 }}>
      <View>
        <Text variant="h3">Admin notes</Text>
        <Text variant="small" tone="muted">Only Tallyko staff see these: deal terms, contacts, support history.</Text>
      </View>
      <Input value={form.notes} onChangeText={(notes) => edit({ notes })} multiline maxLength={2000} editable={editable}
        placeholder={editable ? 'e.g. Paid yearly by bank transfer; call Rakesh after 6 pm.' : 'No notes'}
        style={{ minHeight: 96, textAlignVertical: 'top', paddingTop: 10 }} accessibilityLabel="Admin notes" />
      <Text variant="caption" tone="subtle" style={{ alignSelf: 'flex-end' }}>{form.notes.length}/2000</Text>
    </Card>
  );
  const staffCard = <StaffCard business={b} />;
  const activityCard = <ActivityCard entries={activity.data} loading={activity.loading} error={activity.error} onRetry={activity.reload} />;

  return (
    <AdminPage
      title={b.name}
      subtitle={`${BUSINESS_TYPE_LABEL[b.business_type] ?? b.business_type} · joined ${shortDate(b.created_at)} · ${b.last_activity_at ? `last bill ${ago(b.last_activity_at)} ago` : 'no bills yet'}`}
      back={{ label: panel ? 'Close' : 'All businesses', onPress: goBack }}
      refreshing={detail.refreshing}
      onRefresh={reloadAll}
      maxWidth={1320}
      actions={panel ? <Button title="Full page" icon="open-outline" variant="outline" size="sm" onPress={() => router.push(`/admin/businesses/${b.id}` as Href)} /> : undefined}
      toolbar={
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <StatusBadge status={b.status} />
          <PlanBadge name={currentPlanName} />
          <AccessBadge access={b.access} />
          {b.access?.paid_until ? (
            <Text variant="small" tone="muted">
              {b.access.state === 'development' ? 'No expiry'
                : b.access.state === 'lapsed' || b.access.state === 'grace' ? `Ended ${shortDate(b.access.paid_until)}`
                  : `${accessDaysText(b.access)} · until ${shortDate(b.access.paid_until)}`}
            </Text>
          ) : null}
        </View>
      }
      footer={editable ? (
        <SaveBar visible={dirty} saving={saving} onSave={save} onDiscard={() => setDraft(null)} disabled={!online || limitErrors.length > 0}
          message={online ? 'Unsaved changes to plan, features, limits or notes' : "You're offline: changes can't be saved yet"} />
      ) : null}
    >
      {!canEditRole ? <ReadOnlyNote what="change businesses" /> : null}
      {twoCol ? (
        <View style={{ flexDirection: 'row', gap: 20, alignItems: 'flex-start' }}>
          <View style={{ flex: 1.55, minWidth: 0, gap: 20 }}>
            {planCard}
            {limitsCard}
            {notesCard}
            {staffCard}
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 20 }}>
            {statusCard}
            {accessCard}
            {paymentsCard}
            {devicesCard}
            {ownerCard}
            {activityCard}
          </View>
        </View>
      ) : null}
      {twoCol ? recordsCard : (
        <View style={{ gap: 20 }}>
          {statusCard}
          {accessCard}
          {paymentsCard}
          {devicesCard}
          {ownerCard}
          {planCard}
          {limitsCard}
          {notesCard}
          {staffCard}
          {recordsCard}
          {activityCard}
        </View>
      )}

      {sheet === 'suspend' ? (
        <SuspendSheet business={b} onClose={() => setSheet(null)} onDone={(next) => { applyDetail(next); setSheet(null); }} />
      ) : null}
      {sheet === 'payment' ? (
        <RecordPaymentSheet business={b} plans={planList} onClose={() => setSheet(null)}
          onDone={() => { setSheet(null); setDraft(null); void detail.silentReload(); void activity.silentReload(); }} />
      ) : null}
      {sheet && typeof sheet === 'object' ? (
        <CredentialsSheet title="Owner password reset" heading="New temporary password" email={sheet.email} password={sheet.password}
          message="The old password no longer works. Send these details to the owner privately." onClose={() => setSheet(null)} />
      ) : null}
    </AdminPage>
  );
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

function CardTitle({ title, subtitle, right }: { title: string; subtitle?: string; right?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="h3" accessibilityRole="header">{title}</Text>
        {subtitle ? <Text variant="small" tone="muted">{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

function StatusCard({ business: b, editable, online, busy, onSuspend, onReactivate }: {
  business: BusinessDetail; editable: boolean; online: boolean; busy: boolean; onSuspend: () => void; onReactivate: () => void;
}) {
  if (b.status === 'deleted') {
    return (
      <Callout tone="neutral" icon="archive-outline" title="Closed by the owner">
        The owner deleted this business account. Its records are kept as the law requires, but it can't be changed or reopened from here.
      </Callout>
    );
  }
  if (b.status === 'suspended') {
    return (
      <Callout tone="danger" icon="pause-circle" title="Suspended"
        action={editable ? <Button title="Reactivate" icon="play-circle-outline" variant="success" size="sm" onPress={onReactivate} loading={busy} disabled={!online} /> : undefined}>
        <Text variant="small">{b.status_reason ? `Reason: ${b.status_reason}. ` : ''}The owner and staff can't sign in or bill until it is reactivated.</Text>
      </Callout>
    );
  }
  return (
    <Card style={{ gap: 10 }}>
      <CardTitle title="Account status" subtitle="Active: the owner and staff can sign in and bill."
        right={<StatusBadge status={b.status} />} />
      {editable ? (
        <Button title="Suspend business" icon="pause-circle-outline" variant="secondary" onPress={onSuspend} disabled={!online} style={{ alignSelf: 'flex-start' }} />
      ) : null}
    </Card>
  );
}

function OwnerCard({ business: b, editable, online, resetting, onReset }: {
  business: BusinessDetail; editable: boolean; online: boolean; resetting: boolean; onReset: () => void;
}) {
  const s = b.settings;
  return (
    <Card style={{ gap: 6 }}>
      <CardTitle title="Owner & contact" />
      <KeyValue label="Owner" value={b.owner.name ?? '—'} />
      <KeyValue label="Email" value={b.owner.email ?? '—'}
        right={b.owner.email ? <Button icon="copy-outline" size="sm" variant="ghost" accessibilityLabel="Copy owner email" onPress={() => copyText(b.owner.email!, 'Email')} /> : undefined} />
      <KeyValue label="Phone" value={b.owner.phone ?? s?.phone ?? '—'}
        right={(b.owner.phone ?? s?.phone) ? <Button icon="copy-outline" size="sm" variant="ghost" accessibilityLabel="Copy owner phone" onPress={() => copyText((b.owner.phone ?? s?.phone)!, 'Phone')} /> : undefined} />
      {s?.email && s.email !== b.owner.email ? <KeyValue label="Business email" value={s.email} /> : null}
      {s?.address ? <KeyValue label="Address" value={s.address} /> : null}
      <KeyValue label="GSTIN" value={s?.gstin || (s?.gst_registration === 'unregistered' ? 'Not registered' : '—')} mono={!!s?.gstin} />
      <KeyValue label="Business ID" value={b.id} mono
        right={<Button icon="copy-outline" size="sm" variant="ghost" accessibilityLabel="Copy business ID" onPress={() => copyText(b.id, 'Business ID')} />} />
      {editable ? (
        <>
          <Divider style={{ marginVertical: 6 }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <Text variant="small" tone="muted" style={{ flex: 1, minWidth: 180 }}>Locked out? Give the owner a new temporary password.</Text>
            <Button title="Reset owner password" icon="key-outline" variant="secondary" size="sm" onPress={onReset} loading={resetting} disabled={!online || !b.owner.email} />
          </View>
        </>
      ) : null}
    </Card>
  );
}

function featureMode(features: Record<string, boolean>, key: string): FeatureMode {
  if (!(key in features)) return 'default';
  return features[key] ? 'on' : 'off';
}

const FEATURE_MODES: { value: FeatureMode; label: string }[] = [
  { value: 'default', label: 'Plan default' }, { value: 'on', label: 'Force on' }, { value: 'off', label: 'Force off' },
];

function PlanFeaturesCard({ business: b, form, plans, plansError, selectedPlan, editable, onPlan, onFeature }: {
  business: BusinessDetail; form: Draft; plans: PlanInfo[]; plansError: string | null; selectedPlan: PlanInfo | null; editable: boolean;
  onPlan: (key: string) => void; onFeature: (key: string, mode: FeatureMode) => void;
}) {
  const { isPhone } = useLayout();
  const planFeatures = new Set(selectedPlan?.features ?? []);
  const hidden = new Set(b.hidden_by_owner);
  const overrides = Object.keys(form.features).length;
  const planOptions = plans.filter((p) => p.is_active || p.key === b.plan_key || p.key === form.planKey);
  return (
    <Card style={{ gap: 14 }}>
      <CardTitle title="Plan & features"
        subtitle="Features come from the plan. Override single features for this business without changing the plan." />
      <View style={{ gap: 6 }}>
        <Text variant="smallStrong" tone="muted">Plan</Text>
        {plans.length ? (
          editable ? (
            <ChoiceChips value={form.planKey} onChange={onPlan} accessibilityLabel="Plan"
              options={planOptions.map((p) => ({ value: p.key, label: p.price_monthly ? `${p.name} · ₹${p.price_monthly.toLocaleString('en-IN')}/mo` : p.name }))} />
          ) : <PlanBadge name={selectedPlan?.name ?? form.planKey} />
        ) : plansError ? <Text variant="small" tone="danger">Couldn't load plans: {plansError}</Text> : <Text variant="small" tone="subtle">Loading plans…</Text>}
        {form.planKey !== b.plan_key ? (
          <Text variant="small" tone="warning">Plan changes when you save. Recording a payment also sets the plan.</Text>
        ) : null}
      </View>

      <Divider />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Text variant="smallStrong" tone="muted" style={{ flex: 1 }}>Features</Text>
        {overrides ? <Badge label={`${overrides} override${overrides === 1 ? '' : 's'}`} tone="accent" /> : <Badge label="All from plan" tone="neutral" />}
      </View>
      <View>
        {b.features_catalog.map((f, i) => {
          const mode = featureMode(form.features, f.key);
          const inPlan = planFeatures.has(f.key);
          const enabled = mode === 'default' ? inPlan : mode === 'on';
          const status = (
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <Text variant="caption" tone="subtle">{selectedPlan ? (inPlan ? `In ${selectedPlan.name}` : `Not in ${selectedPlan.name}`) : ''}</Text>
              <Badge label={enabled ? 'On' : 'Off'} tone={enabled ? 'success' : 'neutral'} icon={enabled ? 'checkmark' : 'close'} />
              {mode !== 'default' ? <Badge label="Override" tone="accent" /> : null}
              {enabled && hidden.has(f.key) ? <Badge label="Hidden by owner" tone="info" icon="eye-off-outline" /> : null}
            </View>
          );
          return (
            <View key={f.key}>
              {i > 0 ? <Divider /> : null}
              <View style={{ flexDirection: isPhone ? 'column' : 'row', alignItems: isPhone ? 'stretch' : 'center', gap: isPhone ? 8 : 12, paddingVertical: 10 }}>
                <View style={{ flex: isPhone ? undefined : 1, minWidth: 0, gap: 3 }}>
                  <Text variant="bodyStrong" numberOfLines={2}>{f.name}</Text>
                  {status}
                </View>
                {editable ? (
                  <View style={{ width: isPhone ? '100%' : 320 }}>
                    <Segmented size="sm" value={mode} options={FEATURE_MODES} onChange={(m) => onFeature(f.key, m)} />
                  </View>
                ) : null}
              </View>
            </View>
          );
        })}
      </View>
      {b.hidden_by_owner.length ? (
        <Text variant="small" tone="subtle">"Hidden by owner": the business has the feature but the owner switched it off in their settings.</Text>
      ) : null}
    </Card>
  );
}

const LIMIT_MODES: { value: LimitMode; label: string }[] = [
  { value: 'plan', label: 'Plan' }, { value: 'custom', label: 'Custom' }, { value: 'unlimited', label: 'Unlimited' },
];

function LimitsCard({ business: b, form, selectedPlan, editable, onLimit }: {
  business: BusinessDetail; form: Draft; selectedPlan: PlanInfo | null; editable: boolean; onLimit: (key: LimitKey, l: LimitDraft) => void;
}) {
  const { isPhone } = useLayout();
  const usage: Partial<Record<LimitKey, number>> = { max_staff: b.staff_count, max_products: b.products };
  return (
    <Card style={{ gap: 14 }}>
      <CardTitle title="Limits" subtitle="Use the plan's limits, set a custom number for this business, or remove the limit." />
      {LIMIT_KEYS.map((key, i) => {
        const l = form.limits[key];
        const planValue = selectedPlan ? selectedPlan.limits[key] : undefined;
        const effective = l.mode === 'plan' ? planValue : l.mode === 'unlimited' ? null : (/^\d+$/.test(l.value.trim()) ? Number(l.value.trim()) : undefined);
        const used = usage[key];
        const over = used !== undefined && typeof effective === 'number' && used > effective;
        return (
          <View key={key} style={{ gap: 8 }}>
            {i > 0 ? <Divider /> : null}
            <View style={{ flexDirection: isPhone ? 'column' : 'row', gap: isPhone ? 8 : 12, alignItems: isPhone ? 'stretch' : 'center' }}>
              <View style={{ flex: isPhone ? undefined : 1, minWidth: 0, gap: 2 }}>
                <Text variant="bodyStrong">{LIMIT_LABEL[key]}</Text>
                <Text variant="small" tone={over ? 'danger' : 'muted'}>
                  {effective === undefined ? '—' : limitText(effective)}
                  {used !== undefined ? ` · using ${used.toLocaleString('en-IN')}` : ''}
                  {selectedPlan && l.mode !== 'plan' ? ` · plan: ${limitText(planValue)}` : ''}
                </Text>
              </View>
              {editable ? (
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start', width: isPhone ? '100%' : 380 }}>
                  <View style={{ flex: 1 }}>
                    <Segmented size="sm" value={l.mode} options={LIMIT_MODES}
                      onChange={(mode) => onLimit(key, { mode, value: mode === 'custom' ? (l.value || (typeof planValue === 'number' ? String(planValue) : '')) : '' })} />
                  </View>
                  {l.mode === 'custom' ? (
                    <Input value={l.value} onChangeText={(value) => onLimit(key, { mode: 'custom', value: value.replace(/[^0-9]/g, '') })}
                      keyboardType="number-pad" maxLength={7} containerStyle={{ width: 100 }} accessibilityLabel={`${LIMIT_LABEL[key]} limit`}
                      error={limitError(l) ? ' ' : undefined} placeholder="0" />
                  ) : null}
                </View>
              ) : null}
            </View>
            {editable && limitError(l) ? <Text variant="small" tone="danger">{limitError(l)}</Text> : null}
            {over ? <Text variant="small" tone="danger">Already above this limit: nothing is removed, but they can't add more.</Text> : null}
          </View>
        );
      })}
    </Card>
  );
}

function StaffCard({ business: b }: { business: BusinessDetail }) {
  const active = b.staff.filter((s) => s.is_active).length;
  return (
    <Card style={{ gap: 8 }}>
      <CardTitle title="Staff logins" subtitle={`${active} active${b.staff.length > active ? ` · ${b.staff.length - active} deactivated` : ''} · ${b.products.toLocaleString('en-IN')} products on the menu`} />
      {b.staff.length === 0 ? <Text variant="small" tone="subtle">No logins.</Text> : null}
      {b.staff.map((s, i) => (
        <View key={s.id}>
          {i > 0 ? <Divider style={{ marginBottom: 8 }} /> : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text variant="bodyStrong" tone={s.is_active ? 'default' : 'muted'} numberOfLines={1}>{s.name || s.email}</Text>
              <Text variant="small" tone="muted" numberOfLines={1}>{s.email}</Text>
            </View>
            <Badge label={s.role.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())} tone={s.role === 'owner' ? 'accent' : 'neutral'} />
            {!s.is_active ? <Badge label="Deactivated" tone="danger" /> : null}
          </View>
        </View>
      ))}
    </Card>
  );
}

function detailsText(details: Record<string, unknown> | null): string {
  if (!details) return '';
  return Object.entries(details)
    .filter(([, v]) => v !== null && v !== undefined && !(Array.isArray(v) && v.length > 6))
    .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(' · ');
}

function ActivityCard({ entries, loading, error, onRetry }: { entries: AuditEntry[] | null; loading: boolean; error: string | null; onRetry: () => void }) {
  return (
    <Card style={{ gap: 8 }}>
      <CardTitle title="Platform activity" subtitle="Changes Tallyko staff made to this business." />
      {loading && !entries ? <Loading /> : null}
      {error && !entries ? <ErrorState message={error} onRetry={onRetry} /> : null}
      {entries && entries.length === 0 ? <EmptyState icon="time-outline" title="Nothing yet" message="Plan changes, payments and suspensions appear here." /> : null}
      {(entries ?? []).map((e, i) => (
        <View key={e.id} style={{ gap: 2 }}>
          {i > 0 ? <Divider style={{ marginBottom: 8 }} /> : null}
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <Text variant="smallStrong" style={{ flex: 1 }} numberOfLines={1}>{actionLabel(e.action)}</Text>
            <Text variant="caption" tone="subtle">{formatDateTime(e.created_at)}</Text>
          </View>
          {detailsText(e.details) ? <Text variant="small" tone="muted" numberOfLines={3}>{detailsText(e.details)}</Text> : null}
          <Text variant="caption" tone="subtle">{e.actor_email}</Text>
        </View>
      ))}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Sheets
// ---------------------------------------------------------------------------

const SUSPEND_REASONS = ['Payment pending', 'Requested by owner', 'Suspicious activity', 'Terms violation'];

function SuspendSheet({ business: b, onClose, onDone }: { business: BusinessDetail; onClose: () => void; onDone: (next: BusinessDetail) => void }) {
  const online = useOnline();
  const [reason, setReason] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const error = submitted && reason.trim().length < 3 ? 'Give a short reason (it is shown in the audit log).' : undefined;

  const submit = async () => {
    setSubmitted(true);
    if (reason.trim().length < 3) return;
    setSaving(true);
    try {
      const next = await platformApi.updateBusiness(b.id, { status: 'suspended', status_reason: reason.trim() });
      toast.success(`${b.name} suspended`);
      onDone(next);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet visible onClose={onClose} title={`Suspend ${b.name}?`} width={520}
      footer={
        <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'flex-end' }}>
          <Button title="Cancel" variant="secondary" onPress={onClose} disabled={saving} />
          <Button title="Suspend business" variant="danger" icon="pause-circle-outline" onPress={submit} loading={saving} disabled={!online} />
        </View>
      }>
      <Callout tone="danger">The owner and every staff login are blocked from signing in and billing until you reactivate. No data is deleted.</Callout>
      <Input label="Reason" required value={reason} onChangeText={setReason} maxLength={200} error={error} autoFocus
        placeholder="e.g. Payment pending" hint="Starts with “Payment”? Recording a payment reactivates the business automatically." />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {SUSPEND_REASONS.map((r) => (
          <Button key={r} title={r} size="sm" variant={reason === r ? 'soft' : 'secondary'} onPress={() => setReason(r)} />
        ))}
      </View>
    </Sheet>
  );
}
