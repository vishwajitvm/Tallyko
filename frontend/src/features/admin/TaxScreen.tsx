/**
 * Platform GST rate library. When the government changes a GST rate, publish the new rate with its effective date:
 * every business tax class that follows the preset gets it scheduled, bills switch at that moment and older bills keep their GST.
 */
import React, { useState } from 'react';
import { View } from 'react-native';
import { errorMessage } from '@/api/client';
import { platformApi, type TaxPreset, type TaxRateVersion } from '@/api/platform';
import { Badge, Button, Card, Divider, EmptyState, ErrorState, Input, Loading, Sheet, Text, toast } from '@/components/ui';
import { useApi } from '@/hooks/useApi';
import { useLayout } from '@/theme/ThemeProvider';
import { Callout, ChoiceChips, FieldRow, monoFont } from '@/features/settings/components';
import { fieldErrorsFrom } from '@/features/settings/validation';
import { AdminPage, ReadOnlyNote, istDate, istMidnightIso, shortDate, useCanEdit, useOnline } from './shared';

const COMMON_RATES = [0, 5, 18, 40, 3, 12, 28];

function rateText(rate: number | null | undefined): string {
  if (rate === null || rate === undefined) return '—';
  return `${Number(rate.toFixed(3))}%`;
}

function componentsText(v: TaxRateVersion): string {
  if (!v.components?.length) return 'No tax';
  return v.components.map((c) => `${c.name} ${rateText(c.rate)}`).join(' + ');
}

function validRate(value: string): number | null {
  const v = value.trim();
  if (!/^\d{1,3}(\.\d{1,3})?$/.test(v)) return null;
  const n = Number(v);
  return n >= 0 && n <= 100 ? n : null;
}

export default function TaxScreen() {
  const canEdit = useCanEdit();
  const { data, error, loading, refreshing, reload, setData, silentReload } = useApi(() => platformApi.taxPresets(), []);
  const [schedule, setSchedule] = useState<TaxPreset | null>(null);
  const [creating, setCreating] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const upcoming = (data ?? []).filter((p) => p.versions.some((v) => v.upcoming)).length;

  return (
    <AdminPage
      title="GST rate library"
      subtitle="Standard GST slabs businesses pick for their items. When a rate changes, schedule it here once and every business following the slab switches on the effective date."
      refreshing={refreshing}
      onRefresh={reload}
      actions={canEdit ? <Button title="New slab" icon="add" variant="secondary" onPress={() => setCreating(true)} /> : null}
    >
      {!canEdit ? <ReadOnlyNote what="change GST rates" /> : null}
      {loading && !data ? <Loading label="Loading GST slabs" /> : null}
      {error && !data ? <ErrorState message={error} onRetry={reload} /> : null}
      {data && data.length === 0 ? <EmptyState icon="receipt-outline" title="No GST slabs" message="Built-in slabs are added automatically; refresh to try again." /> : null}
      {upcoming ? (
        <Callout tone="info" icon="calendar-outline" title={`${upcoming} scheduled rate change${upcoming === 1 ? '' : 's'}`}>
          Bills switch to the new rate automatically on the effective date (India time). Bills made before keep their original GST.
        </Callout>
      ) : null}

      {(data ?? []).map((p) => (
        <PresetCard key={p.key} preset={p} canEdit={canEdit} expanded={!!expanded[p.key]}
          onToggle={() => setExpanded((s) => ({ ...s, [p.key]: !s[p.key] }))} onSchedule={() => setSchedule(p)} />
      ))}

      {schedule ? (
        <ScheduleRateSheet preset={schedule} onClose={() => setSchedule(null)}
          onDone={() => { setExpanded((s) => ({ ...s, [schedule.key]: true })); setSchedule(null); void silentReload(); }} />
      ) : null}
      {creating ? (
        <NewPresetSheet existing={data ?? []} onClose={() => setCreating(false)} onDone={(next) => { setData(next); setCreating(false); }} />
      ) : null}
    </AdminPage>
  );
}

function PresetCard({ preset: p, canEdit, expanded, onToggle, onSchedule }: {
  preset: TaxPreset; canEdit: boolean; expanded: boolean; onToggle: () => void; onSchedule: () => void;
}) {
  const { isPhone } = useLayout();
  const next = p.versions.filter((v) => v.upcoming).sort((a, b) => a.effective_from.localeCompare(b.effective_from))[0];
  const current = [...p.versions].filter((v) => !v.upcoming).sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0];
  const history = [...p.versions].sort((a, b) => b.effective_from.localeCompare(a.effective_from));
  return (
    <Card style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Text variant="h3">{p.name}</Text>
            {!p.is_active ? <Badge label="Inactive" tone="neutral" /> : null}
            {next ? <Badge label={`→ ${rateText(next.total_rate)} from ${shortDate(next.effective_from)}`} tone="info" icon="calendar-outline" /> : null}
          </View>
          <Text variant="caption" tone="subtle" style={{ fontFamily: monoFont }}>{p.key}{p.hsn_sac ? `  ·  HSN/SAC ${p.hsn_sac}` : ''}</Text>
          {p.description ? <Text variant="small" tone="muted">{p.description}</Text> : null}
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text variant={isPhone ? 'h1' : 'moneyLarge'}>{rateText(p.current_rate)}</Text>
          <Text variant="caption" tone="subtle" numberOfLines={1}>{current ? componentsText(current) : 'Not in force yet'}</Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Button title={expanded ? 'Hide history' : `Rate history (${p.versions.length})`} icon={expanded ? 'chevron-up' : 'chevron-down'} size="sm" variant="ghost" onPress={onToggle} />
        {canEdit ? <Button title="Schedule rate change" icon="calendar-outline" size="sm" variant="secondary" onPress={onSchedule} /> : null}
      </View>
      {expanded ? (
        <View>
          {history.map((v, i) => {
            const isCurrent = current?.id === v.id;
            return (
              <View key={v.id}>
                <Divider />
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 10 }}>
                  <View style={{ width: isPhone ? 92 : 120 }}>
                    <Text variant="smallStrong">{shortDate(v.effective_from)}</Text>
                    <Text variant="caption" tone="subtle">{i === history.length - 1 ? 'first rate' : 'effective from'}</Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <Text variant="bodyStrong">{rateText(v.total_rate)}</Text>
                      {v.upcoming ? <Badge label="Upcoming" tone="info" /> : isCurrent ? <Badge label="Current" tone="success" /> : <Badge label="Past" tone="neutral" />}
                    </View>
                    <Text variant="small" tone="muted">{componentsText(v)}</Text>
                    {v.note ? <Text variant="small" tone="subtle">{v.note}</Text> : null}
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      ) : null}
    </Card>
  );
}

function RateField({ value, onChange, error }: { value: string; onChange: (v: string) => void; error?: string }) {
  const n = validRate(value);
  return (
    <View style={{ gap: 6 }}>
      <Text variant="smallStrong" tone="muted">New total GST rate</Text>
      <ChoiceChips value={n !== null && COMMON_RATES.includes(n) ? String(n) : ''} onChange={onChange} accessibilityLabel="Common GST rates"
        options={COMMON_RATES.map((r) => ({ value: String(r), label: `${r}%` }))} />
      <Input value={value} onChangeText={(v) => onChange(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" maxLength={7} error={error}
        accessibilityLabel="GST rate in percent" placeholder="e.g. 18" right={<Text tone="muted" style={{ marginRight: 12 }}>%</Text>}
        hint={n !== null ? (n === 0 ? 'Nil rated: no CGST / SGST.' : `Intra-state: CGST ${rateText(n / 2)} + SGST ${rateText(n / 2)} (IGST ${rateText(n)} inter-state).`) : undefined} />
    </View>
  );
}

function ScheduleRateSheet({ preset: p, onClose, onDone }: { preset: TaxPreset; onClose: () => void; onDone: () => void }) {
  const online = useOnline();
  const [rate, setRate] = useState('');
  const [date, setDate] = useState(istDate(1));
  const [note, setNote] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const n = validRate(rate);
  const effective = istMidnightIso(date);
  const errors = {
    rate: n === null ? 'Enter a rate between 0 and 100.' : n === p.current_rate && date <= istDate() ? 'That is already the current rate.' : undefined,
    date: !effective ? 'Use the format YYYY-MM-DD.' : undefined,
  };
  const invalid = Object.values(errors).some(Boolean);
  const past = !!effective && date < istDate();

  const review = () => {
    setSubmitted(true);
    setFormError(null);
    if (!invalid) setReviewing(true);
  };

  const publish = async () => {
    if (invalid || n === null || !effective) return;
    setSaving(true);
    try {
      const r = await platformApi.publishTaxRate(p.key, { rate: n, effective_from: effective, note: note.trim() || null });
      toast.success(`${p.name}: ${rateText(n)} from ${shortDate(effective)} · ${r.businesses_updated} business tax class${r.businesses_updated === 1 ? '' : 'es'} scheduled`);
      onDone();
    } catch (e) {
      setFormError(errorMessage(e));
      setReviewing(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet visible onClose={onClose} title="Schedule GST rate change" subtitle={`${p.name} · now ${rateText(p.current_rate)}`} width={580}
      footer={
        <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'flex-end' }}>
          {reviewing ? (
            <>
              <Button title="Back" variant="secondary" onPress={() => setReviewing(false)} disabled={saving} />
              <Button title="Publish rate" icon="megaphone-outline" onPress={publish} loading={saving} disabled={!online} />
            </>
          ) : (
            <>
              <Button title="Cancel" variant="secondary" onPress={onClose} />
              <Button title="Review" icon="arrow-forward" onPress={review} />
            </>
          )}
        </View>
      }>
      {formError ? <Callout tone="danger">{formError}</Callout> : null}
      {!online ? <Callout tone="warning">You're offline. Connect to publish the rate.</Callout> : null}
      {reviewing && n !== null && effective ? (
        <>
          <Callout tone="warning" title={`Publish ${rateText(n)} for “${p.name}” from ${shortDate(effective)}?`}>
            Every business whose tax class follows this slab switches to {rateText(n)} at midnight India time on {shortDate(effective)}. Bills made before keep their
            original GST. Businesses that set their own rate for the class are not changed. Publishing the same date again replaces that scheduled rate.
          </Callout>
          <Card style={{ gap: 6 }}>
            <Text variant="small" tone="muted">Rate</Text>
            <Text variant="h2">{rateText(p.current_rate)} → {rateText(n)}</Text>
            <Text variant="small" tone="muted" style={{ marginTop: 6 }}>Effective</Text>
            <Text variant="bodyStrong">{shortDate(effective)}, 00:00 IST</Text>
            {note.trim() ? (
              <>
                <Text variant="small" tone="muted" style={{ marginTop: 6 }}>Note</Text>
                <Text>{note.trim()}</Text>
              </>
            ) : null}
          </Card>
        </>
      ) : (
        <>
          <RateField value={rate} onChange={setRate} error={submitted ? errors.rate : undefined} />
          <Input label="Effective from (India date)" required value={date} onChangeText={setDate} maxLength={10} placeholder="YYYY-MM-DD"
            error={submitted ? errors.date : undefined} autoCapitalize="none" autoCorrect={false}
            hint={effective ? `Starts ${shortDate(effective)} at 00:00 IST.` : 'YYYY-MM-DD, e.g. 2026-11-01'} />
          {past ? <Callout tone="warning">This date is in the past. Bills already made keep their GST; new bills use the new rate immediately.</Callout> : null}
          <Input label="Note" value={note} onChangeText={setNote} maxLength={300} placeholder="e.g. CBIC notification 09/2026-CT (Rate)"
            hint="Shown in the rate history and the audit log." />
        </>
      )}
    </Sheet>
  );
}

function NewPresetSheet({ existing, onClose, onDone }: { existing: TaxPreset[]; onClose: () => void; onDone: (next: TaxPreset[]) => void }) {
  const online = useOnline();
  const [key, setKey] = useState('GST_');
  const [name, setName] = useState('');
  const [hsn, setHsn] = useState('');
  const [description, setDescription] = useState('');
  const [rate, setRate] = useState('');
  const [date, setDate] = useState(istDate());
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const n = validRate(rate);
  const effective = istMidnightIso(date);
  const errors: Record<string, string | undefined> = {
    key: !/^[A-Z0-9_]{2,40}$/.test(key) ? 'Capital letters, digits and _ (2–40).' : existing.some((p) => p.key === key) ? 'A slab with this key exists.' : undefined,
    name: name.trim().length < 2 ? 'At least 2 characters.' : undefined,
    rate: n === null ? 'Enter a rate between 0 and 100.' : undefined,
    effective_from: !effective ? 'Use the format YYYY-MM-DD.' : undefined,
    hsn_sac: hsn.trim() && !/^\d{4,8}$/.test(hsn.trim()) ? '4 to 8 digits.' : undefined,
  };
  const show = (k: string) => serverErrors[k] || (submitted ? errors[k] : undefined);

  const submit = async () => {
    setSubmitted(true);
    setFormError(null);
    if (Object.values(errors).some(Boolean) || n === null || !effective) return;
    setSaving(true);
    try {
      const next = await platformApi.createTaxPreset({
        key, name: name.trim(), hsn_sac: hsn.trim() || null, description: description.trim() || null, rate: n, effective_from: effective,
      });
      toast.success(`${name.trim()} added to the GST library`);
      onDone(next);
    } catch (e) {
      setServerErrors(fieldErrorsFrom(e));
      setFormError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet visible onClose={onClose} title="New GST slab" subtitle="Businesses can pick it for their items and follow its future rate changes." width={620}
      footer={
        <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'flex-end' }}>
          <Button title="Cancel" variant="secondary" onPress={onClose} disabled={saving} />
          <Button title="Add slab" icon="checkmark" onPress={submit} loading={saving} disabled={!online} />
        </View>
      }>
      {formError ? <Callout tone="danger">{formError}</Callout> : null}
      <FieldRow>
        <Input label="Name" required value={name} onChangeText={setName} maxLength={80} error={show('name')} placeholder="e.g. GST 12% (textiles)" autoFocus />
        <Input label="Key" required value={key} onChangeText={(v) => setKey(v.toUpperCase().replace(/[^A-Z0-9_]/g, ''))} maxLength={40} error={show('key')}
          autoCapitalize="characters" autoCorrect={false} hint="Permanent id, e.g. GST_12_TEXTILE" />
      </FieldRow>
      <FieldRow>
        <Input label="HSN / SAC (optional)" value={hsn} onChangeText={(v) => setHsn(v.replace(/[^0-9]/g, ''))} maxLength={8} keyboardType="number-pad" error={show('hsn_sac')} />
        <Input label="Effective from (India date)" required value={date} onChangeText={setDate} maxLength={10} placeholder="YYYY-MM-DD" error={show('effective_from')}
          autoCapitalize="none" autoCorrect={false} />
      </FieldRow>
      <Input label="Description" value={description} onChangeText={setDescription} maxLength={300} placeholder="Which goods or services use this slab?" />
      <RateField value={rate} onChange={setRate} error={show('rate')} />
    </Sheet>
  );
}
