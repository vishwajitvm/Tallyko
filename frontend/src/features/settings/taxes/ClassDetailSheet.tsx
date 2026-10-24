/**
 * One tax class: rate history timeline, "schedule a rate change" (the government changed GST for my items),
 * cancel an upcoming change, rename / HSN-SAC / follow the library / turn off.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { errorMessage } from '@/api/client';
import {
  describeComponents, formatRate, sortedRates, splitGst, taxesApi, type TaxClass, type TaxOverview, type TaxRateVersion,
} from '@/api/taxes';
import { Badge, Button, Input, Sheet, Text, toast } from '@/components/ui';
import { confirmTop as confirm } from '@/features/catalog/dialogs';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import { Callout, ChoiceChips, FieldRow, Hairline, SettingSwitch } from '../components';
import { DateTimeField, RatePill, formatEffective, tomorrowMidnight } from './shared';

const QUICK_RATES = [0, 3, 5, 18, 40];
const HSN_PATTERN = /^[0-9]{4,8}$/;

function rateBefore(rates: TaxRateVersion[], at: Date): TaxRateVersion | null {
  const t = at.getTime();
  return sortedRates(rates).find((r) => new Date(r.effective_from).getTime() <= t) ?? null;
}

function parseRate(text: string): number | null {
  if (!text.trim()) return null;
  const n = Number(text.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export function ClassDetailSheet({ taxClass, canEdit, online, onClose, onChanged, onAssign }: {
  taxClass: TaxClass; canEdit: boolean; online: boolean; onClose: () => void; onChanged: (o: TaxOverview) => void;
  /** Open bulk assignment with this class picked */
  onAssign?: () => void;
}) {
  const { colors } = useTheme();
  const { isPhone } = useLayout();
  const editable = canEdit && online;
  const history = useMemo(() => sortedRates(taxClass.rates), [taxClass.rates]);

  // --- schedule a change ---
  const [scheduling, setScheduling] = useState(false);
  const [rateText, setRateText] = useState('');
  const [when, setWhen] = useState<Date | null>(() => tomorrowMidnight());
  const [note, setNote] = useState('');
  const [igst, setIgst] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState<null | 'schedule' | 'details' | 'active' | string>(null);

  // --- details ---
  const [name, setName] = useState(taxClass.name);
  const [hsn, setHsn] = useState(taxClass.hsn_sac ?? '');
  useEffect(() => {
    setName(taxClass.name);
    setHsn(taxClass.hsn_sac ?? '');
  }, [taxClass.id, taxClass.name, taxClass.hsn_sac]);

  const rate = parseRate(rateText);
  const previous = when ? rateBefore(taxClass.rates, when) : null;
  const rateError = !rateText.trim() ? 'Enter the new GST rate.' : rate === null || rate < 0 || rate > 100 ? 'Use a rate from 0 to 100.' : null;
  const whenError = !when
    ? 'Enter a valid date and time.'
    : when.getTime() < Date.now() - 60_000
      ? "A change can't start in the past — bills already issued keep their tax."
      : taxClass.rates.some((r) => new Date(r.effective_from).getTime() === when.getTime())
        ? 'A change is already scheduled at that exact time.'
        : null;
  const sameRate = rate !== null && previous && Number(previous.total_rate) === rate && !igst;
  const scheduleInvalid = !!rateError || !!whenError || note.length > 300;

  const components = rate !== null ? (igst ? [{ name: 'IGST', rate }] : splitGst(rate)) : [];
  const previewText = rate !== null && when
    ? `From ${formatEffective(when)}, ${taxClass.name}: ${previous ? `${formatRate(previous.total_rate)}% → ` : ''}${formatRate(rate)}% (${describeComponents(components, rate)})`
    : null;

  const resetSchedule = () => {
    setScheduling(false);
    setRateText('');
    setWhen(tomorrowMidnight());
    setNote('');
    setIgst(false);
    setSubmitted(false);
  };

  const schedule = async () => {
    setSubmitted(true);
    if (scheduleInvalid || rate === null || !when) return;
    const ok = await confirm({
      title: 'Schedule this GST change?',
      message: `${previewText}.\n\nBills made before then keep the old rate. ${taxClass.follow_preset ? 'This class will stop following the Tallyko GST library, so later government changes will not be applied to it automatically.' : ''}`.trim(),
      confirmLabel: 'Schedule change',
    });
    if (!ok) return;
    setBusy('schedule');
    try {
      const overview = await taxesApi.scheduleRate(taxClass.id, { rate, effective_from: when.toISOString(), note: note.trim() || null, igst_only: igst });
      onChanged(overview);
      toast.success(`${taxClass.name}: ${formatRate(rate)}% from ${formatEffective(when)}`);
      resetSchedule();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const cancelChange = async (r: TaxRateVersion) => {
    const ok = await confirm({
      title: 'Cancel this rate change?',
      message: `${taxClass.name} will not change to ${formatRate(r.total_rate)}% on ${formatEffective(r.effective_from)}.`,
      confirmLabel: 'Cancel change',
      danger: true,
    });
    if (!ok) return;
    setBusy(r.id);
    try {
      onChanged(await taxesApi.cancelRate(taxClass.id, r.id));
      toast.success('Scheduled change cancelled');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const nameError = name.trim().length < 2 ? 'Use at least 2 characters.' : name.trim().length > 80 ? 'Use 80 characters or fewer.' : null;
  const hsnError = hsn.trim() && !HSN_PATTERN.test(hsn.trim()) ? 'HSN/SAC is 4 to 8 digits.' : null;
  const detailsDirty = name.trim() !== taxClass.name || (hsn.trim() || null) !== (taxClass.hsn_sac ?? null);

  const saveDetails = async () => {
    if (nameError || hsnError) return;
    setBusy('details');
    try {
      onChanged(await taxesApi.update(taxClass.id, { name: name.trim(), hsn_sac: hsn.trim() }));
      toast.success('Tax class saved');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const setFollow = async (follow: boolean) => {
    setBusy('follow');
    try {
      onChanged(await taxesApi.update(taxClass.id, { follow_preset: follow }));
      toast.success(follow ? 'Now follows the Tallyko GST library' : 'Stopped following the GST library');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const toggleActive = async () => {
    const turningOff = taxClass.is_active;
    if (turningOff) {
      const ok = await confirm({
        title: `Turn off ${taxClass.name}?`,
        message: taxClass.products
          ? `${taxClass.products} item${taxClass.products === 1 ? '' : 's'} use this class. They will be billed with your default tax class until you assign another one. Past bills don't change.`
          : 'It will no longer be offered for items. Past bills don\'t change.',
        confirmLabel: 'Turn off',
        danger: true,
      });
      if (!ok) return;
    }
    setBusy('active');
    try {
      onChanged(await taxesApi.update(taxClass.id, { is_active: !turningOff }));
      toast.success(turningOff ? `${taxClass.name} turned off` : `${taxClass.name} turned on`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const anyBusy = busy !== null;
  const current = history.find((r) => r.current) ?? null;

  return (
    <Sheet visible onClose={anyBusy ? () => undefined : onClose} title={taxClass.name} width={680}
      subtitle={`${taxClass.current_rate === null ? 'No rate yet' : `GST ${formatRate(taxClass.current_rate)}% · ${describeComponents(taxClass.current_components, taxClass.current_rate)}`} · ${taxClass.products} item${taxClass.products === 1 ? '' : 's'}`}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {taxClass.is_default ? <Badge label="Business default" tone="primary" icon="star" /> : null}
        {taxClass.follow_preset ? <Badge label="Follows Tallyko GST library" tone="info" icon="sync" /> : taxClass.preset_key ? <Badge label="Managed by you" tone="neutral" /> : null}
        {!taxClass.is_active ? <Badge label="Turned off" tone="warning" /> : null}
        {taxClass.hsn_sac ? <Badge label={`HSN/SAC ${taxClass.hsn_sac}`} tone="neutral" /> : null}
      </View>
      {onAssign && editable && taxClass.is_active ? (
        <Button title={taxClass.products ? `Add more items to ${taxClass.name}` : `Assign items to ${taxClass.name}`} icon="git-merge-outline" variant="secondary"
          size="sm" onPress={onAssign} disabled={anyBusy} style={{ alignSelf: 'flex-start' }} />
      ) : null}

      {/* Rate history */}
      <View style={{ gap: 4 }}>
        <Text variant="h3">Rate history</Text>
        <Text variant="small" tone="muted">Each bill keeps the rate that applied when it was made.</Text>
      </View>
      <View>
        {history.map((r, i) => {
          const tone = r.upcoming ? colors.warning : r.current ? colors.primary : colors.borderStrong;
          const last = i === history.length - 1;
          return (
            <View key={r.id} style={{ flexDirection: 'row', gap: 12 }}>
              <View style={{ width: 16, alignItems: 'center' }}>
                <View style={{ width: 12, height: 12, borderRadius: 6, marginTop: 5, backgroundColor: r.upcoming ? colors.surface : tone, borderWidth: 2, borderColor: tone }} />
                {!last ? <View style={{ flex: 1, width: 2, backgroundColor: colors.border, marginVertical: 2 }} /> : null}
              </View>
              <View style={{ flex: 1, minWidth: 0, paddingBottom: last ? 0 : 16, gap: 2 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <Text variant="bodyStrong">{formatRate(r.total_rate)}%</Text>
                  <Text variant="small" tone="muted">{describeComponents(r.components, r.total_rate)}</Text>
                  {r.current ? <Badge label="Current" tone="success" /> : null}
                  {r.upcoming ? <Badge label="Upcoming" tone="warning" icon="time-outline" /> : null}
                </View>
                <Text variant="small">{r.upcoming ? 'Starts' : 'From'} {formatEffective(r.effective_from)}</Text>
                <Text variant="small" tone="subtle">
                  {[r.note, r.source === 'preset' ? 'Tallyko GST library' : 'Set by your business'].filter(Boolean).join(' · ')}
                </Text>
                {r.upcoming && editable ? (
                  <Button title="Cancel this change" size="sm" variant="ghost" icon="close-circle-outline" onPress={() => cancelChange(r)}
                    loading={busy === r.id} disabled={anyBusy} style={{ alignSelf: 'flex-start', marginLeft: -12 }} />
                ) : null}
              </View>
            </View>
          );
        })}
        {!history.length ? <Text tone="muted">No rate set yet.</Text> : null}
      </View>

      {/* Schedule a change */}
      {canEdit && taxClass.is_active ? (
        <View style={{ gap: 12, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: scheduling ? colors.primary : colors.border,
          backgroundColor: scheduling ? colors.surfaceAlt : colors.surface }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Ionicons name="calendar-outline" size={20} color={colors.primary} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text variant="bodyStrong">Government changed the rate?</Text>
              <Text variant="small" tone="muted">Schedule the new rate. Bills switch automatically on that date.</Text>
            </View>
            {!scheduling ? <Button title="Schedule change" size="sm" variant="soft" icon="add" onPress={() => setScheduling(true)} disabled={!online} /> : null}
          </View>
          {scheduling ? (
            <>
              <View style={{ gap: 6 }}>
                <Input label="New GST rate" value={rateText} onChangeText={(t) => setRateText(t.replace(/[^\d.,]/g, ''))} keyboardType="decimal-pad"
                  maxLength={6} placeholder={current ? formatRate(current.total_rate) : '5'} right={<Text tone="muted" style={{ marginRight: 12 }}>%</Text>}
                  error={submitted ? rateError : null} containerStyle={{ maxWidth: isPhone ? undefined : 220 }} />
                <ChoiceChips<number> value={rate ?? -1} onChange={(v) => setRateText(String(v))} accessibilityLabel="Common GST rates"
                  options={QUICK_RATES.map((r) => ({ value: r, label: `${r}%` }))} />
              </View>
              <DateTimeField value={when} onChange={setWhen} error={submitted || when === null ? whenError : null} />
              <Input label="Government notification (optional)" value={note} onChangeText={setNote} maxLength={300}
                placeholder="e.g. Notification No. 9/2025-Central Tax (Rate)" hint="Kept with the rate so you can show where it came from." />
              <SettingSwitch title="Charge as IGST only" value={igst} onValueChange={setIgst}
                subtitle="Only for businesses that bill inter-state supplies. Leave off for normal CGST + SGST bills." />
              {previewText ? (
                <Callout tone={sameRate ? 'warning' : 'info'} icon="eye-outline" title="Preview">
                  {sameRate ? `${previewText}. This is the same as the rate already in effect then.` : previewText}
                </Callout>
              ) : null}
              {taxClass.follow_preset ? (
                <Text variant="small" tone="warning">Scheduling your own change stops automatic updates from the Tallyko GST library for this class.</Text>
              ) : null}
              <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                <Button title="Cancel" variant="secondary" onPress={resetSchedule} disabled={anyBusy} />
                <Button title="Review & schedule" icon="checkmark" onPress={schedule} loading={busy === 'schedule'} disabled={anyBusy || !online || (submitted && scheduleInvalid)} />
              </View>
            </>
          ) : null}
        </View>
      ) : null}

      {/* Details */}
      {canEdit ? (
        <>
          <Hairline />
          <Text variant="h3">Details</Text>
          <FieldRow>
            <Input label="Name" value={name} onChangeText={setName} maxLength={80} error={nameError} editable={editable} />
            <Input label="HSN / SAC code" value={hsn} onChangeText={(t) => setHsn(t.replace(/\D/g, ''))} maxLength={8} keyboardType="number-pad"
              error={hsnError} hint="Printed on tax invoices. 4–8 digits." editable={editable} placeholder="e.g. 996331" />
          </FieldRow>
          {detailsDirty ? (
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
              <Button title="Undo" variant="secondary" onPress={() => { setName(taxClass.name); setHsn(taxClass.hsn_sac ?? ''); }} disabled={anyBusy} />
              <Button title="Save details" icon="checkmark" onPress={saveDetails} loading={busy === 'details'} disabled={anyBusy || !online || !!nameError || !!hsnError} />
            </View>
          ) : null}
          {taxClass.preset_key ? (
            <SettingSwitch title="Follow the Tallyko GST library" value={taxClass.follow_preset} onValueChange={setFollow} disabled={!editable || anyBusy}
              subtitle="When the government changes this slab, Tallyko schedules the new rate for you. Turn off to manage the rate yourself." />
          ) : null}
          <Hairline />
          <View style={{ flexDirection: isPhone ? 'column' : 'row', gap: 10, alignItems: isPhone ? 'stretch' : 'center' }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text variant="bodyStrong">{taxClass.is_active ? 'Turn off this class' : 'This class is turned off'}</Text>
              <Text variant="small" tone="muted">
                {taxClass.is_default && taxClass.is_active ? 'Choose another default class before turning this one off.'
                  : taxClass.is_active ? 'Items using it fall back to your default class. Past bills never change.' : 'Turn it on to use it for items again.'}
              </Text>
            </View>
            <Button title={taxClass.is_active ? 'Turn off' : 'Turn on'} variant={taxClass.is_active ? 'secondary' : 'soft'}
              icon={taxClass.is_active ? 'pause-circle-outline' : 'play-circle-outline'} onPress={toggleActive} loading={busy === 'active'}
              disabled={anyBusy || !online || (taxClass.is_default && taxClass.is_active)} />
          </View>
        </>
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <RatePill rate={taxClass.current_rate} muted={!taxClass.is_active} />
          <Text variant="small" tone="muted" style={{ flex: 1 }}>Ask the owner or a manager to change this tax class.</Text>
        </View>
      )}
    </Sheet>
  );
}
