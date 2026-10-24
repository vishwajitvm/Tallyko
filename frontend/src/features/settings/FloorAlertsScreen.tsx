/**
 * Settings → Floor alerts. When a table, a kitchen ticket or a waiting online order turns amber and red on the
 * floor screens (Tables, Kitchen, Online orders). Saved as the business setting `ops_thresholds`.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api, errorMessage } from '@/api/client';
import type { BusinessSettings } from '@/api/types';
import { Button, EmptyState, ErrorState, Input, Loading, Text, toast } from '@/components/ui';
import { useApi } from '@/hooks/useApi';
import { can, useAuth } from '@/store/auth';
import { hasAccess, useAccessInfo } from '@/store/access';
import { useData } from '@/store/data';
import { SettingsFrame } from './SettingsFrame';
import { Callout, FieldRow, FormSection, SaveBar } from './components';
import { OPS_DEFAULTS, opsFormOf, opsValues, validateOps, type OpsForm, type OpsKey } from './floorAlerts';

export default function FloorAlertsScreen() {
  const role = useAuth((s) => s.session?.role ?? null);
  const access = useAccessInfo();
  const allowed = hasAccess(access, { permissions: ['settings.manage'] }) ?? can(role, 'manage');
  if (!allowed) {
    return (
      <SettingsFrame active="floor" title="Floor alerts">
        <EmptyState icon="lock-closed-outline" title="Owners and managers only" message="Ask the owner or a manager to change the floor alert times." />
      </SettingsFrame>
    );
  }
  return <FloorAlertsSettings />;
}

function FloorAlertsSettings() {
  const { data, error, loading, reload, refreshing, setData } = useApi(() => api.get<BusinessSettings>('/settings'), []);
  const initial = useMemo(() => (data ? opsFormOf(data.ops_thresholds) : null), [data]);
  const [form, setForm] = useState<OpsForm | null>(null);
  const [saving, setSaving] = useState(false);

  // Follow fresh server data unless the user is in the middle of editing
  const lastInitial = useRef<string | null>(null);
  useEffect(() => {
    if (!initial) return;
    const previous = lastInitial.current;
    lastInitial.current = JSON.stringify(initial);
    setForm((f) => (!f || previous === null || JSON.stringify(f) === previous ? initial : f));
  }, [initial]);

  if (loading && !data) return <SettingsFrame active="floor" title="Floor alerts"><Loading label="Loading floor alerts" /></SettingsFrame>;
  if (!data || !form || !initial) {
    return <SettingsFrame active="floor" title="Floor alerts"><ErrorState message={error ?? 'Couldn’t load the settings.'} onRetry={reload} /></SettingsFrame>;
  }

  const errors = validateOps(form);
  const invalid = Object.keys(errors).length > 0;
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const isDefault = JSON.stringify(form) === JSON.stringify(opsFormOf(OPS_DEFAULTS));
  const set = (k: OpsKey) => (v: string) => setForm((f) => (f ? { ...f, [k]: v.replace(/[^0-9]/g, '') } : f));

  const save = async () => {
    if (invalid) {
      toast.error(Object.values(errors)[0] ?? 'Check the times');
      return;
    }
    setSaving(true);
    try {
      const settings = await api.put<BusinessSettings>('/settings', { ops_thresholds: opsValues(form) });
      useData.getState().setSettings(settings); // the floor screens read the times from here
      setData(settings);
      setForm(opsFormOf(settings.ops_thresholds));
      toast.success('Floor alerts saved');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const field = (k: OpsKey, label: string, hint?: string) => (
    <Input label={label} value={form[k]} onChangeText={set(k)} keyboardType="number-pad" maxLength={3} error={errors[k]} hint={hint}
      right={<Text variant="small" tone="subtle">min</Text>} />
  );

  return (
    <SettingsFrame active="floor" title="Floor alerts"
      subtitle="When tables, kitchen tickets and online orders turn amber and then red, so staff see what needs attention first."
      dirty={dirty} refreshing={refreshing} onRefresh={reload}
      actions={!isDefault ? <Button title="Use defaults" size="sm" variant="ghost" icon="refresh-outline" onPress={() => setForm(opsFormOf(OPS_DEFAULTS))} /> : undefined}
      footer={<SaveBar visible={dirty} saving={saving} onSave={save} onDiscard={() => setForm(initial)} disabled={invalid} />}>
      <FormSection title="Tables" description="Time since the first bill on the table was opened.">
        <FieldRow>
          {field('table_amber_min', 'Amber after', `Default ${OPS_DEFAULTS.table_amber_min}`)}
          {field('table_red_min', 'Red after', `Default ${OPS_DEFAULTS.table_red_min}`)}
        </FieldRow>
      </FormSection>
      <FormSection title="Kitchen" description="Time since the KOT reached the kitchen.">
        <FieldRow>
          {field('kitchen_amber_min', 'Amber after', `Default ${OPS_DEFAULTS.kitchen_amber_min}`)}
          {field('kitchen_red_min', 'Red after', `Default ${OPS_DEFAULTS.kitchen_red_min}`)}
        </FieldRow>
      </FormSection>
      <FormSection title="Online orders" description="Time a new Swiggy, Zomato, QR or store order has been waiting to be accepted.">
        {field('online_wait_min', 'Amber after', `Turns red at twice this time. Default ${OPS_DEFAULTS.online_wait_min}`)}
      </FormSection>
      <Callout tone="neutral" icon="phone-portrait-outline">
        This device uses the new times straight away; other tills, tablets and kitchen screens pick them up at their next sync (about a minute).
      </Callout>
    </SettingsFrame>
  );
}
