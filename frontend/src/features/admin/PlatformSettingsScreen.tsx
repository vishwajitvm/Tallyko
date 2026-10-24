/**
 * Platform settings: free demo length for new businesses, grace and reminder days, the payment details owners see on the
 * renewal page, and the daily subscription check (01:00 India time) with "Run check now".
 */
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { errorMessage } from '@/api/client';
import { platformApi, type JobsInfo, type PlatformSettings } from '@/api/platform';
import { Badge, Button, Card, Divider, ErrorState, Input, Loading, Text, confirm, toast } from '@/components/ui';
import { useApi } from '@/hooks/useApi';
import { ago, formatDateTime } from '@/lib/format';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import { Callout, ChoiceChips, FieldRow, KeyValue, SaveBar } from '@/features/settings/components';
import { validateEmail } from '@/features/settings/validation';
import { AdminPage, ReadOnlyNote, plural, useCanEdit, useOnline } from './shared';

interface Draft {
  trialDays: string;
  graceDays: string;
  reminderDays: string;
  upiId: string;
  payeeName: string;
  bankDetails: string;
  supportPhone: string;
  supportEmail: string;
  instructions: string;
}

const DEMO_CHOICES = [0, 7, 14, 30];

function draftFrom(s: PlatformSettings): Draft {
  return {
    trialDays: String(s.trial_days), graceDays: String(s.grace_days), reminderDays: String(s.reminder_days),
    upiId: s.payment.upi_id ?? '', payeeName: s.payment.payee_name ?? '', bankDetails: s.payment.bank_details ?? '',
    supportPhone: s.payment.support_phone ?? '', supportEmail: s.payment.support_email ?? '', instructions: s.payment.instructions ?? '',
  };
}

function wholeIn(v: string, max: number): number | null {
  const t = v.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n <= max ? n : null;
}

export function daysLabel(n: number): string {
  return n === 0 ? 'No demo' : `${n} day${n === 1 ? '' : 's'}`;
}

/** "in 5 h 20 min" until a future time. */
function untilText(iso: string, now = Date.now()): string {
  const mins = Math.max(0, Math.round((new Date(iso).getTime() - now) / 60_000));
  if (mins < 60) return `in ${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h >= 24 ? `in ${Math.floor(h / 24)} d ${h % 24} h` : `in ${h} h${m ? ` ${m} min` : ''}`;
}

export default function PlatformSettingsScreen() {
  const { width } = useLayout();
  const canEdit = useCanEdit();
  const online = useOnline();
  const settings = useApi(() => platformApi.settings(), []);
  const jobs = useApi(() => platformApi.jobs(), []);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const baseline = useMemo(() => (settings.data ? draftFrom(settings.data) : null), [settings.data]);
  const form = draft ?? baseline;
  const dirty = !!(draft && baseline && JSON.stringify(draft) !== JSON.stringify(baseline));
  const twoCol = width >= 1180;

  const edit = (patch: Partial<Draft>) => form && setDraft({ ...form, ...patch });

  const errors: Record<string, string | undefined> = form ? {
    trialDays: wholeIn(form.trialDays, 365) === null ? '0–365 days.' : undefined,
    graceDays: wholeIn(form.graceDays, 60) === null ? '0–60 days.' : undefined,
    reminderDays: wholeIn(form.reminderDays, 60) === null ? '0–60 days.' : undefined,
    supportEmail: form.supportEmail.trim() ? validateEmail(form.supportEmail, false) : undefined,
    payeeName: form.upiId.trim() && !form.payeeName.trim() ? 'Who the UPI app should show as the payee.' : undefined,
  } : {};
  const hasErrors = Object.values(errors).some(Boolean);

  const save = async () => {
    if (!form || hasErrors) {
      toast.error('Fix the highlighted fields before saving.');
      return;
    }
    setSaving(true);
    try {
      const next = await platformApi.saveSettings({
        trial_days: Number(form.trialDays.trim()), grace_days: Number(form.graceDays.trim()), reminder_days: Number(form.reminderDays.trim()),
        payment: {
          upi_id: form.upiId.trim(), payee_name: form.payeeName.trim(), bank_details: form.bankDetails.trim(),
          support_phone: form.supportPhone.trim(), support_email: form.supportEmail.trim(), instructions: form.instructions.trim(),
        },
      });
      settings.setData(next);
      setDraft(null);
      toast.success('Platform settings saved');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  if (!form) {
    return (
      <AdminPage title="Platform settings">
        {settings.loading ? <Loading label="Loading settings" /> : null}
        {settings.error && !settings.loading ? <ErrorState message={settings.error} onRetry={settings.reload} /> : null}
      </AdminPage>
    );
  }

  const demoCard = <DemoCard form={form} errors={errors} canEdit={canEdit} onChange={edit} />;
  const renewalCard = <RenewalCard form={form} errors={errors} canEdit={canEdit} onChange={edit} />;
  const paymentCard = <PaymentCard form={form} errors={errors} canEdit={canEdit} onChange={edit} />;
  const jobCard = <JobCard data={jobs.data} loading={jobs.loading} error={jobs.error} onRetry={jobs.reload} canEdit={canEdit} onRan={() => void jobs.silentReload()} />;

  return (
    <AdminPage
      title="Platform settings"
      subtitle="Demo length, grace days, how owners pay you, and the nightly subscription check."
      refreshing={settings.refreshing}
      onRefresh={() => { void settings.reload(); void jobs.reload(); }}
      footer={canEdit ? (
        <SaveBar visible={dirty} saving={saving} onSave={save} onDiscard={() => setDraft(null)} disabled={!online || hasErrors}
          message={online ? 'Unsaved platform settings' : "You're offline: changes can't be saved yet"} />
      ) : null}
    >
      {!canEdit ? <ReadOnlyNote what="change platform settings" /> : null}
      {twoCol ? (
        <View style={{ flexDirection: 'row', gap: 20, alignItems: 'flex-start' }}>
          <View style={{ flex: 1.4, minWidth: 0, gap: 20 }}>
            {demoCard}
            {renewalCard}
            {paymentCard}
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 20 }}>{jobCard}</View>
        </View>
      ) : (
        <View style={{ gap: 20 }}>
          {demoCard}
          {renewalCard}
          {paymentCard}
          {jobCard}
        </View>
      )}
    </AdminPage>
  );
}

interface CardProps { form: Draft; errors: Record<string, string | undefined>; canEdit: boolean; onChange: (patch: Partial<Draft>) => void }

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

function DemoCard({ form, errors, canEdit, onChange }: CardProps) {
  const n = wholeIn(form.trialDays, 365);
  return (
    <Card style={{ gap: 12 }}>
      <CardTitle title="Free demo for new businesses" subtitle="Every new sign-up (and businesses you onboard) gets this many days to try Tallyko before paying."
        right={<Badge label={n === null ? '—' : daysLabel(n)} tone={n ? 'info' : 'neutral'} icon="hourglass-outline" />} />
      {canEdit ? (
        <View style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'flex-start' }}>
            <ChoiceChips value={n !== null && DEMO_CHOICES.includes(n) ? String(n) : ''} onChange={(v) => onChange({ trialDays: v })} accessibilityLabel="Demo length"
              options={DEMO_CHOICES.map((d) => ({ value: String(d), label: daysLabel(d) }))} />
            <Input value={form.trialDays} onChangeText={(v) => onChange({ trialDays: v.replace(/[^0-9]/g, '') })} keyboardType="number-pad" maxLength={3}
              containerStyle={{ width: 100 }} accessibilityLabel="Demo days" error={errors.trialDays ? ' ' : undefined} />
          </View>
          {errors.trialDays ? <Text variant="small" tone="danger">{errors.trialDays}</Text> : null}
        </View>
      ) : null}
      <Text variant="small" tone="subtle">
        0 = no demo: new businesses are locked until their first payment. You can still give any business a demo from its page.
      </Text>
    </Card>
  );
}

function RenewalCard({ form, errors, canEdit, onChange }: CardProps) {
  const grace = wholeIn(form.graceDays, 60);
  if (!canEdit) {
    return (
      <Card style={{ gap: 6 }}>
        <CardTitle title="Renewal" />
        <KeyValue label="Grace days" value={form.graceDays} />
        <KeyValue label="Reminder days" value={form.reminderDays} />
      </Card>
    );
  }
  return (
    <Card style={{ gap: 12 }}>
      <CardTitle title="Renewal" subtitle="What happens around the end of a paid period." />
      <FieldRow>
        <Input label="Grace days" value={form.graceDays} onChangeText={(v) => onChange({ graceDays: v.replace(/[^0-9]/g, '') })} keyboardType="number-pad"
          maxLength={2} error={errors.graceDays}
          hint={grace ? `Keeps working ${grace} day${grace === 1 ? '' : 's'} after the paid date, then locks.` : 'Locks on the day the paid period ends.'} />
        <Input label="Reminder days" value={form.reminderDays} onChangeText={(v) => onChange({ reminderDays: v.replace(/[^0-9]/g, '') })} keyboardType="number-pad"
          maxLength={2} error={errors.reminderDays} hint="Owners see a renewal reminder this many days before the end." />
      </FieldRow>
    </Card>
  );
}

function PaymentCard({ form, errors, canEdit, onChange }: CardProps) {
  const { colors, radius } = useTheme();
  const preview = (
    <View style={{ padding: 12, borderRadius: radius.md, backgroundColor: colors.surfaceSunken, gap: 4 }}>
      <Text variant="caption" tone="subtle">WHAT OWNERS SEE</Text>
      {form.upiId.trim() ? <Text variant="smallStrong">UPI: {form.upiId.trim()}{form.payeeName.trim() ? ` (${form.payeeName.trim()})` : ''}</Text> : <Text variant="small" tone="warning">No UPI ID yet: owners can't pay by UPI.</Text>}
      {form.bankDetails.trim() ? <Text variant="small">{form.bankDetails.trim()}</Text> : null}
      {form.instructions.trim() ? <Text variant="small" tone="muted">{form.instructions.trim()}</Text> : null}
      {form.supportPhone.trim() || form.supportEmail.trim() ? (
        <Text variant="small" tone="muted">Help: {[form.supportPhone.trim(), form.supportEmail.trim()].filter(Boolean).join(' · ')}</Text>
      ) : null}
    </View>
  );
  if (!canEdit) {
    return (
      <Card style={{ gap: 10 }}>
        <CardTitle title="How owners pay" subtitle="Shown on the renewal page of a locked or expiring business." />
        {preview}
      </Card>
    );
  }
  return (
    <Card style={{ gap: 12 }}>
      <CardTitle title="How owners pay" subtitle="Shown on the renewal page of a locked or expiring business." />
      <FieldRow>
        <Input label="UPI ID" value={form.upiId} onChangeText={(upiId) => onChange({ upiId })} maxLength={80} autoCapitalize="none" autoCorrect={false}
          placeholder="tallyko@okhdfcbank" />
        <Input label="Payee name" value={form.payeeName} onChangeText={(payeeName) => onChange({ payeeName })} maxLength={80} error={errors.payeeName}
          placeholder="Tallyko" />
      </FieldRow>
      <Input label="Bank details" value={form.bankDetails} onChangeText={(bankDetails) => onChange({ bankDetails })} maxLength={400} multiline
        placeholder={'A/c 1234567890 · IFSC HDFC0001234\nTallyko Technologies, HDFC Bank, Pune'} style={{ minHeight: 72, textAlignVertical: 'top', paddingTop: 10 }} />
      <FieldRow>
        <Input label="Support phone" value={form.supportPhone} onChangeText={(supportPhone) => onChange({ supportPhone })} maxLength={30} keyboardType="phone-pad"
          placeholder="+91 98765 43210" />
        <Input label="Support email" value={form.supportEmail} onChangeText={(supportEmail) => onChange({ supportEmail })} maxLength={120} keyboardType="email-address"
          autoCapitalize="none" autoCorrect={false} error={errors.supportEmail} placeholder="billing@tallyko.in" />
      </FieldRow>
      <Input label="Instructions" value={form.instructions} onChangeText={(instructions) => onChange({ instructions })} maxLength={600} multiline
        style={{ minHeight: 88, textAlignVertical: 'top', paddingTop: 10 }} hint={`${form.instructions.length}/600`} />
      {preview}
    </Card>
  );
}

function JobCard({ data, loading, error, onRetry, canEdit, onRan }: {
  data: JobsInfo | null; loading: boolean; error: string | null; onRetry: () => void; canEdit: boolean; onRan: () => void;
}) {
  const online = useOnline();
  const [running, setRunning] = useState(false);
  const job = data?.subscription_check;
  const last = job?.last_run ?? null;

  const runNow = async () => {
    const ok = await confirm({
      title: 'Run the subscription check now?', confirmLabel: 'Run check', danger: true,
      message: 'Businesses whose subscription (plus grace days) has ended are locked and every one of their devices is signed out. Bills waiting on those devices stay safe and sync after renewal.',
    });
    if (!ok) return;
    setRunning(true);
    try {
      const r = await platformApi.runSubscriptionCheck();
      toast.success(`Check done: ${plural(r.businesses_checked, 'business', 'businesses')} checked, ${r.locked_now} newly locked`);
      onRan();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card style={{ gap: 12 }}>
      <CardTitle title="Daily subscription check"
        subtitle="Locks businesses whose subscription ended and signs out all their devices, so open screens close too."
        right={job ? <Badge label={job.enabled ? 'Scheduled' : 'Off'} tone={job.enabled ? 'success' : 'warning'} icon={job.enabled ? 'time-outline' : 'pause-outline'} /> : undefined} />
      {loading && !data ? <Loading /> : null}
      {error && !data ? <ErrorState message={error} onRetry={onRetry} /> : null}
      {job ? (
        <>
          <View style={{ gap: 2 }}>
            <KeyValue label="Schedule" value={job.schedule} />
            <KeyValue label="Next run" value={job.enabled ? `${formatDateTime(job.next_run_at)} (${untilText(job.next_run_at)})` : 'Not scheduled on this server'} />
          </View>
          {!job.enabled ? <Callout tone="warning">The scheduler is switched off on this server (JOB_SCHEDULER_ENABLED). Run the check by hand or turn it on.</Callout> : null}
          <Divider />
          <Text variant="smallStrong" tone="muted">Last run</Text>
          {last ? (
            <View style={{ gap: 10 }}>
              <Text variant="small" tone="muted">{formatDateTime(last.last_run_at)} · {ago(last.last_run_at)} ago · by {last.by}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                <MiniStat label="Checked" value={last.businesses_checked.toLocaleString('en-IN')} />
                <MiniStat label="Locked" value={last.locked_now.toLocaleString('en-IN')} tone={last.locked_now ? 'danger' : undefined} />
                <MiniStat label="Due soon" value={last.renewals_due_soon.toLocaleString('en-IN')} tone={last.renewals_due_soon ? 'warning' : undefined} />
                <MiniStat label="Took" value={`${last.duration_ms} ms`} />
              </View>
            </View>
          ) : <Text variant="small" tone="subtle">Hasn't run yet.</Text>}
          {canEdit ? (
            <Button title="Run check now" icon="play-circle-outline" variant="secondary" onPress={runNow} loading={running} disabled={!online} style={{ alignSelf: 'flex-start' }} />
          ) : null}
        </>
      ) : null}
    </Card>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: 'danger' | 'warning' }) {
  const { colors, radius } = useTheme();
  return (
    <View style={{ flexGrow: 1, flexBasis: 110, padding: 10, borderRadius: radius.md, backgroundColor: colors.surfaceSunken, gap: 2 }}>
      <Text variant="caption" tone="subtle">{label.toUpperCase()}</Text>
      <Text variant="h3" tone={tone ?? 'default'}>{value}</Text>
    </View>
  );
}
