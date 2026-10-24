/**
 * Settings → QR table ordering. Owner/manager turn table ordering on or off, choose how guests pay
 * (counter / UPI / both), whether staff confirm each order before it reaches the kitchen (the QR channel's
 * auto-accept, inverted), and print the table QR codes.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Platform, View } from 'react-native';
import { router, type Href } from 'expo-router';
import { api, errorMessage, ApiError } from '@/api/client';
import { adminApi, tablesApi } from '@/api/endpoints';
import type { BusinessSettings, SalesChannel, TableInfo } from '@/api/types';
import { Button, Chip, EmptyState, ErrorState, Input, Loading, Text, toast } from '@/components/ui';
import { useApi } from '@/hooks/useApi';
import { can, useAuth } from '@/store/auth';
import { hasAccess, useAccessInfo } from '@/store/access';
import { useData } from '@/store/data';
import { useTheme } from '@/theme/ThemeProvider';
import { printTableQrs } from '@/features/ops/tableQr';
import { tableOrderUrl } from '@/features/ops/common';
import { SettingsFrame, confirmDiscard } from './SettingsFrame';
import { Callout, ChoiceChips, FormSection, Hairline, SaveBar, SettingSwitch, copyText, monoFont } from './components';
import { validateUpi } from './validation';

type PaymentMode = 'counter' | 'upi' | 'both';
type QrSettings = BusinessSettings & { qr_payment_mode?: PaymentMode | null };

interface Form { enabled: boolean; mode: PaymentMode; upiId: string; staffConfirm: boolean }

const MODE_OPTIONS: { value: PaymentMode; label: string }[] = [
  { value: 'counter', label: 'At the counter' },
  { value: 'upi', label: 'UPI only' },
  { value: 'both', label: 'Counter or UPI' },
];

const MODE_HELP: Record<PaymentMode, string> = {
  counter: 'Guests pay the cashier or waiter (cash, card or UPI) when they’re done. Simple and familiar.',
  upi: 'Guests pay from their own UPI app right after ordering. Staff confirm each payment before the bill closes.',
  both: 'Guests choose: pay at the counter, or pay now by UPI from their phone.',
};

function formOf(s: QrSettings, qr: SalesChannel | undefined): Form {
  return {
    enabled: !!s.qr_ordering_enabled,
    mode: s.qr_payment_mode ?? 'both',
    upiId: s.upi_id ?? '',
    staffConfirm: qr ? !qr.auto_accept : true,
  };
}

export default function QrOrderingScreen() {
  const role = useAuth((s) => s.session?.role ?? null);
  const access = useAccessInfo();
  const allowed = hasAccess(access, { permissions: ['settings.manage'] }) ?? can(role, 'manage');
  if (!allowed) {
    return (
      <SettingsFrame active="qr" title="QR table ordering">
        <EmptyState icon="lock-closed-outline" title="Owners and managers only" message="Ask the owner or a manager to change QR table ordering." />
      </SettingsFrame>
    );
  }
  return <QrOrderingSettings />;
}

function QrOrderingSettings() {
  const { colors } = useTheme();
  const access = useAccessInfo();
  const role = useAuth((s) => s.session?.role ?? null);
  const tenantId = useAuth((s) => s.session?.tenantId ?? '');
  const inPlan = access ? access.features.includes('qr_ordering') : true; // unknown until /access/me loads: the server decides
  const { data, error, loading, reload, refreshing, setData } = useApi(async () => {
    const [settings, channels] = await Promise.all([api.get<QrSettings>('/settings'), adminApi.channels()]);
    return { settings, qr: channels.find((c) => c.code === 'QR') };
  }, []);
  const tables = useApi(() => tablesApi.list(), []);

  const initial = useMemo(() => (data ? formOf(data.settings, data.qr) : null), [data]);
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [upiTouched, setUpiTouched] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);

  // Follow fresh server data unless the user is in the middle of editing
  const lastInitial = useRef<string | null>(null);
  useEffect(() => {
    if (!initial) return;
    const previous = lastInitial.current;
    lastInitial.current = JSON.stringify(initial);
    setForm((f) => (!f || previous === null || JSON.stringify(f) === previous ? initial : f));
  }, [initial]);

  const activeTables = useMemo<TableInfo[]>(() => (tables.data ?? []).filter((t) => t.is_active !== false), [tables.data]);
  useEffect(() => {
    if (!previewId && activeTables.length) setPreviewId(activeTables[0].id);
  }, [activeTables, previewId]);

  if (loading && !data) {
    return <SettingsFrame active="qr" title="QR table ordering"><Loading label="Loading QR ordering settings" /></SettingsFrame>;
  }
  if (!data || !form || !initial) {
    return (
      <SettingsFrame active="qr" title="QR table ordering">
        <ErrorState message={error ?? 'Couldn’t load the settings.'} onRetry={reload} />
      </SettingsFrame>
    );
  }

  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const needsUpi = form.mode !== 'counter';
  const upiFormatError = validateUpi(form.upiId);
  const upiError = upiFormatError ?? (needsUpi && !form.upiId.trim() ? 'Add your UPI ID so guests can pay by UPI.' : undefined);
  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setServerError(null);
    setForm((f) => (f ? { ...f, [key]: value } : f));
  };

  const save = async () => {
    if (upiError) {
      setUpiTouched(true);
      toast.error(upiError);
      return;
    }
    if (form.enabled && !initial.enabled && !inPlan) {
      toast.error('QR table ordering isn’t included in your plan.');
      return;
    }
    setSaving(true);
    setServerError(null);
    try {
      const body: Record<string, unknown> = { qr_ordering_enabled: form.enabled, qr_payment_mode: form.mode };
      if (form.upiId.trim() !== initial.upiId.trim()) body.upi_id = form.upiId.trim();
      const settings = await api.put<QrSettings>('/settings', body);
      let qr = data.qr;
      if (qr && form.staffConfirm !== initial.staffConfirm) {
        qr = await adminApi.updateChannel('QR', { auto_accept: !form.staffConfirm });
      }
      useData.getState().setSettings(settings);
      // Saving the settings also switches the QR channel on/off on the server: mirror that in the offline cache
      const savedQr = qr ? { ...qr, enabled: !!settings.qr_ordering_enabled } : undefined;
      if (savedQr) useData.setState((s) => ({ channels: s.channels.map((c) => (c.code === 'QR' ? { ...c, ...savedQr } : c)) }));
      setData({ settings, qr: savedQr });
      setForm(formOf(settings, savedQr));
      setUpiTouched(false);
      toast.success(settings.qr_ordering_enabled ? 'QR table ordering is on' : 'QR table ordering saved');
    } catch (e) {
      const message = e instanceof ApiError && (e.status === 403 || e.status === 422) ? e.message : errorMessage(e);
      setServerError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    setForm(initial);
    setUpiTouched(false);
    setServerError(null);
  };

  const print = async () => {
    if (!activeTables.length) return;
    setPrinting(true);
    try {
      await printTableQrs(activeTables, tenantId, data.settings.business_name || 'Scan to order');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setPrinting(false);
    }
  };

  const go = async (href: string) => {
    if (await confirmDiscard(dirty)) router.push(href as Href);
  };

  const preview = activeTables.find((t) => t.id === previewId) ?? null;
  const previewUrl = preview ? tableOrderUrl(tenantId, preview.id) : null;
  const openPreview = () => {
    if (!previewUrl) return;
    if (Platform.OS === 'web' && typeof window !== 'undefined') window.open(previewUrl, '_blank', 'noopener');
    else void Linking.openURL(previewUrl).catch(() => toast.error('Couldn’t open the link.'));
  };

  const live = initial.enabled;

  return (
    <SettingsFrame active="qr" title="QR table ordering"
      subtitle="Guests scan the QR code on their table, see your menu, order and pay — without waiting for a waiter."
      dirty={dirty} refreshing={refreshing} onRefresh={reload}
      footer={<SaveBar visible={dirty} saving={saving} onSave={save} onDiscard={discard} disabled={!!upiError && upiTouched} />}>

      {!inPlan ? (
        <Callout tone="warning" icon="lock-closed" title="Not in your plan"
          action={role === 'owner' ? <Button title="See plans" size="sm" variant="secondary" icon="card-outline" onPress={() => void go('/settings/billing')} /> : undefined}>
          QR table ordering isn’t included in your current plan. Upgrade to let guests order from their table.
        </Callout>
      ) : live ? (
        <Callout tone="success" icon="checkmark-circle" title="Guests can order from their table">
          {initial.staffConfirm
            ? 'New QR orders wait in Online orders until your staff accept them, then go to the kitchen.'
            : 'New QR orders go straight to the kitchen.'}
        </Callout>
      ) : null}

      <FormSection title="Table ordering" description="When this is off, the QR code still shows your menu, but guests can’t place orders.">
        <SettingSwitch title="Let guests order from their table" subtitle={form.enabled ? 'On — guests can order by scanning the table QR' : 'Off — the QR shows the menu only'}
          value={form.enabled} onValueChange={(v) => set('enabled', v)} disabled={!inPlan && !form.enabled} />
        <Hairline />
        <SettingSwitch title="Staff confirm each order before it goes to the kitchen"
          subtitle={form.staffConfirm
            ? 'Recommended. A cashier or waiter accepts each order in Online orders (stops prank orders).'
            : 'Orders go straight to the kitchen and print a KOT as soon as the guest places them.'}
          value={form.staffConfirm} onValueChange={(v) => set('staffConfirm', v)} disabled={!data.qr} />
        <Text variant="small" tone="subtle">
          Each guest gets their own bill on the table (by phone number), so two groups at one table never mix. Ordering again adds to the same bill.
        </Text>
      </FormSection>

      <FormSection title="How guests pay" description="UPI payments go straight to your own UPI ID — no payment gateway, no fees.">
        <ChoiceChips value={form.mode} options={MODE_OPTIONS} onChange={(v) => set('mode', v)} accessibilityLabel="How guests pay" />
        <Text variant="small" tone="muted">{MODE_HELP[form.mode]}</Text>
        {needsUpi || form.upiId ? (
          <Input label="Your UPI ID" required={needsUpi} value={form.upiId} placeholder="yourshop@okaxis" icon="qr-code-outline"
            autoCapitalize="none" autoCorrect={false} keyboardType="email-address" maxLength={100}
            onChangeText={(v) => set('upiId', v.trim())} onBlur={() => setUpiTouched(true)}
            error={upiTouched || form.upiId ? upiError : undefined}
            hint="The same UPI ID is printed on your bills (Settings → Business)." />
        ) : null}
        {needsUpi ? (
          <Callout tone="neutral" icon="shield-checkmark-outline">
            After paying, guests tap “I’ve paid”. Check the money arrived in your UPI app, then confirm it on the bill in Orders — the bill closes only then.
          </Callout>
        ) : null}
        {serverError ? <Callout tone="danger">{serverError}</Callout> : null}
      </FormSection>

      <FormSection title="QR menu & prices" description="What guests see after scanning.">
        <Text variant="small" tone="muted">
          The QR menu shows your active items at their QR price. To charge a different price for an item, or hide it from the QR menu, open the item in Menu
          and set its channel price. To add a mark-up on every item, set the QR channel’s price adjustment in Sales channels.
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Button title="Open menu" size="sm" variant="secondary" icon="restaurant-outline" onPress={() => void go('/menu')} />
          <Button title="Sales channels" size="sm" variant="secondary" icon="git-network-outline" onPress={() => void go('/settings/channels')} />
        </View>
      </FormSection>

      <FormSection title="Table QR codes" description="Print one QR card per table and stick it on the table. Each code opens the menu for that table.">
        {tables.loading && !tables.data ? <Loading label="Loading tables" /> : null}
        {tables.error && !tables.data ? <ErrorState message={tables.error} onRetry={tables.reload} /> : null}
        {tables.data && !activeTables.length ? (
          <EmptyState icon="grid-outline" title="No tables yet" message="Add your tables first; each one gets its own QR code."
            action={{ label: 'Add tables', icon: 'add', onPress: () => void go('/tables') }} />
        ) : null}
        {activeTables.length ? (
          <>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Button title={`Print table QR codes (${activeTables.length})`} icon="print-outline" onPress={print} loading={printing} />
              <Button title="Manage tables" variant="secondary" icon="grid-outline" onPress={() => void go('/tables')} />
            </View>
            <Hairline />
            <View style={{ gap: 8 }}>
              <Text variant="smallStrong">Preview the guest page</Text>
              <Text variant="small" tone="muted">See exactly what guests see when they scan a table’s code.</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {activeTables.slice(0, 24).map((t) => (
                  <Chip key={t.id} label={t.table_number} selected={t.id === previewId} onPress={() => setPreviewId(t.id)} />
                ))}
              </View>
              {previewUrl ? (
                <View style={{ gap: 8 }}>
                  <Text variant="small" tone="subtle" selectable numberOfLines={2} style={{ fontFamily: monoFont }}>{previewUrl}</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    <Button title={`Open Table ${preview?.table_number ?? ''}`} size="sm" icon="open-outline" onPress={openPreview} />
                    <Button title="Copy link" size="sm" variant="secondary" icon="copy-outline" onPress={() => void copyText(previewUrl, 'Link')} />
                  </View>
                  {!live ? (
                    <Text variant="small" color={colors.warningText}>Ordering is off, so the page shows the menu only.</Text>
                  ) : null}
                </View>
              ) : null}
            </View>
          </>
        ) : null}
      </FormSection>
    </SettingsFrame>
  );
}
