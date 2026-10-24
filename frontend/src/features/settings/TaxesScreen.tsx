/**
 * Settings › GST & taxes. Built around "the government changed GST for my items":
 * registration type, prices incl. tax, the default class, tax classes with dated rate changes, and bulk assignment.
 * Past bills never change: each bill keeps the tax that applied when it was made.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { router, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { errorMessage, isOffline } from '@/api/client';
import { adminApi } from '@/api/endpoints';
import {
  describeComponents, formatRate, rememberTaxOverview, taxesApi, upcomingRates, type GstRegistration, type TaxClass, type TaxOverview,
} from '@/api/taxes';
import { Badge, Button, Card, EmptyState, ErrorState, Loading, Text, toast } from '@/components/ui';
import { TopDialogHost, confirmTop } from '@/features/catalog/dialogs';
import { useApi } from '@/hooks/useApi';
import { syncNow } from '@/lib/sync';
import { useData } from '@/store/data';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import { SettingsFrame } from './SettingsFrame';
import { Callout, FormSection, Hairline, SettingSwitch } from './components';
import { AddClassSheet } from './taxes/AddClassSheet';
import { AssignSheet } from './taxes/AssignSheet';
import { ClassDetailSheet } from './taxes/ClassDetailSheet';
import { RatePill, formatEffective, useCanManageTaxes, useOnline } from './taxes/shared';

const REGISTRATION: { key: GstRegistration; title: string; bill: string; detail: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'regular', title: 'Regular GST', bill: 'Tax invoice', icon: 'receipt-outline',
    detail: 'Bills are tax invoices with your GSTIN and CGST + SGST shown for each rate. Choose this if you have a regular GST registration.' },
  { key: 'composition', title: 'Composition scheme', bill: 'Bill of supply', icon: 'document-text-outline',
    detail: 'Bills are a "Bill of supply" with no GST added. You pay a fixed % of turnover yourself and cannot collect GST from customers.' },
  { key: 'unregistered', title: 'Not registered', bill: 'Bill without GST', icon: 'remove-circle-outline',
    detail: 'For businesses below the GST turnover limit. Bills show no GSTIN and no GST.' },
];

export default function TaxesScreen() {
  const { colors } = useTheme();
  const { width, isPhone } = useLayout();
  const canEdit = useCanManageTaxes();
  const online = useOnline();
  const settings = useData((s) => s.settings);
  const { data, setData, error, loading, refreshing, reload } = useApi(() => taxesApi.overview(), []);
  const [busy, setBusy] = useState<null | 'registration' | 'prices' | 'default'>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [assigning, setAssigning] = useState<{ classId?: string | null } | null>(null);
  const [gridWidth, setGridWidth] = useState(0);

  const editable = canEdit && online;
  const classes = data?.classes ?? [];
  const active = useMemo(() => classes.filter((c) => c.is_active), [classes]);
  const defaultClass = classes.find((c) => c.id === data?.default_tax_class_id) ?? null;
  const detail = classes.find((c) => c.id === detailId) ?? null;
  const upcoming = useMemo(
    () => classes.flatMap((c) => upcomingRates(c).map((r) => ({ c, r }))).sort((a, b) => a.r.effective_from.localeCompare(b.r.effective_from)),
    [classes],
  );
  // Keep the product editor's copy of the classes in step with this screen.
  useEffect(() => { if (data) rememberTaxOverview(data); }, [data]);

  const frame = (children: React.ReactNode) => (
    <SettingsFrame active="taxes" title="GST & taxes" subtitle="How GST is charged on your bills, and what happens when the government changes a rate."
      refreshing={refreshing} onRefresh={reload} maxWidth={1040}
      actions={data && canEdit ? <Button title={isPhone ? undefined : 'Add tax class'} icon="add" onPress={() => setAdding(true)} disabled={!online} accessibilityLabel="Add tax class" /> : undefined}>
      {children}
    </SettingsFrame>
  );

  if (loading && !data) return frame(<Loading label="Loading tax settings" />);
  if (!data) {
    return frame(<ErrorState message={error ?? 'Could not load tax settings.'} onRetry={reload} />);
  }

  /** Settings changes go through PUT /settings and are mirrored into the tax overview + offline cache. */
  const saveSetting = async (key: 'registration' | 'prices' | 'default', body: Record<string, unknown>, patch: Partial<TaxOverview>, okMessage: string) => {
    setBusy(key);
    try {
      const saved = await adminApi.updateSettings(body);
      useData.getState().setSettings(saved);
      setData((d) => (d ? { ...d, ...patch, classes: patch.default_tax_class_id !== undefined ? d.classes.map((c) => ({ ...c, is_default: c.id === patch.default_tax_class_id })) : d.classes } : d));
      toast.success(okMessage);
    } catch (e) {
      toast.error(isOffline(e) ? "You're offline. Try again when you're connected." : errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const changeRegistration = async (next: GstRegistration) => {
    if (next === data.registration || !editable) return;
    const info = REGISTRATION.find((r) => r.key === next)!;
    const ok = await confirmTop({
      title: `Switch to ${info.title}?`,
      message: next === 'regular'
        ? 'New bills will be tax invoices with GST charged at each item\'s rate. Make sure your GSTIN is filled in under Business.'
        : `New bills will be a "${info.bill}" with no GST added. Bills already issued don't change.`,
      confirmLabel: 'Switch',
    });
    if (!ok) return;
    await saveSetting('registration', { gst_registration: next }, { registration: next }, `Bills are now: ${info.bill}`);
  };

  const exampleRate = defaultClass?.current_rate ?? 5;
  const inclusiveTax = 100 - 100 / (1 + exampleRate / 100);
  const pricesSubtitle = data.prices_include_tax
    ? `On. A ₹100 item costs the customer ₹100: ₹${(100 - inclusiveTax).toFixed(2)} price + ₹${inclusiveTax.toFixed(2)} GST at ${formatRate(exampleRate)}%.`
    : `Off. A ₹100 item at ${formatRate(exampleRate)}% GST costs the customer ₹${(100 + exampleRate).toFixed(2).replace(/\.00$/, '')}: GST is added on top.`;

  const chargesGst = data.registration === 'regular';
  const missingGstin = chargesGst && settings && !settings.gstin;
  const twoCol = width >= 900;

  return (
    <>
      {frame(
        <>
          {!canEdit ? (
            <Callout tone="neutral" icon="lock-closed-outline" title="View only">
              Only the owner or a manager with settings access can change tax settings.
            </Callout>
          ) : !online ? (
            <Callout tone="warning" icon="cloud-offline-outline" title="You're offline">
              Tax settings can be viewed but not changed until you're back online. Billing keeps using the rates already on this device.
            </Callout>
          ) : null}

          <Callout tone="info" icon="shield-checkmark-outline" title="Past bills never change">
            Each bill keeps the GST rate that applied when it was made. Rate changes you schedule here only affect bills made on or after their start date.
          </Callout>

          {upcoming.length ? (
            <Callout tone="warning" icon="time-outline" title={`${upcoming.length} upcoming rate change${upcoming.length === 1 ? '' : 's'}`}>
              <View style={{ gap: 2 }}>
                {upcoming.slice(0, 5).map(({ c, r }) => (
                  <Text key={r.id} variant="small">
                    {formatEffective(r.effective_from)}: {c.name} {c.current_rate !== null ? `${formatRate(c.current_rate)}% → ` : ''}{formatRate(r.total_rate)}%
                  </Text>
                ))}
              </View>
            </Callout>
          ) : null}

          {/* Registration */}
          <FormSection title="GST registration" description="Decides what kind of bill you print and whether GST is added.">
            <View style={{ flexDirection: twoCol ? 'row' : 'column', gap: 10 }}>
              {REGISTRATION.map((r) => {
                const selected = data.registration === r.key;
                return (
                  <Pressable key={r.key} onPress={() => changeRegistration(r.key)} disabled={!editable || busy !== null}
                    accessibilityRole="radio" accessibilityState={{ checked: selected, disabled: !editable }} accessibilityLabel={`${r.title}. ${r.detail}`}
                    style={({ hovered }: any) => [{
                      flex: twoCol ? 1 : undefined, gap: 6, padding: 14, borderRadius: 12, borderWidth: 1.5,
                      borderColor: selected ? colors.primary : colors.border,
                      backgroundColor: selected ? colors.primarySoft : hovered && editable ? colors.surfaceSunken : colors.surface,
                      opacity: !selected && !editable ? 0.7 : 1,
                    }, Platform.OS === 'web' && editable && ({ cursor: 'pointer' } as any)]}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={18} color={selected ? colors.primary : colors.textSubtle} />
                      <Text variant="bodyStrong" style={{ flex: 1 }} color={selected ? colors.primarySoftText : colors.text}>{r.title}</Text>
                    </View>
                    <Badge label={r.bill} tone={selected ? 'primary' : 'neutral'} icon={r.icon} />
                    <Text variant="small" tone="muted">{r.detail}</Text>
                  </Pressable>
                );
              })}
            </View>
            {busy === 'registration' ? <Text variant="small" tone="muted">Saving…</Text> : null}
            {missingGstin ? (
              <Callout tone="warning" title="GSTIN missing"
                action={<Button title="Add GSTIN" size="sm" variant="secondary" icon="arrow-forward" onPress={() => router.navigate('/settings/business?section=tax' as Href)} />}>
                A tax invoice must show your GSTIN. Add it in Business settings.
              </Callout>
            ) : null}
            {!chargesGst ? (
              <Callout tone="neutral">Your tax classes are kept, but no GST is charged while you are not on regular GST.</Callout>
            ) : null}
          </FormSection>

          {/* Prices & default */}
          <FormSection title="Prices & default rate" description="How menu prices relate to GST, and the class used for items that don't have one.">
            <SettingSwitch title="Menu prices include GST" value={data.prices_include_tax} disabled={!editable || busy !== null}
              onValueChange={(v) => saveSetting('prices', { prices_include_tax: v }, { prices_include_tax: v }, v ? 'Prices now include GST' : 'GST is now added on top of prices')}
              subtitle={pricesSubtitle} />
            <Hairline />
            <View style={{ gap: 8 }}>
              <Text variant="smallStrong" tone="muted">Default tax class</Text>
              {editable ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} accessibilityRole="radiogroup">
                  {active.map((c) => {
                    const selected = c.id === data.default_tax_class_id;
                    return (
                      <Pressable key={c.id} disabled={busy !== null} accessibilityRole="radio" accessibilityState={{ checked: selected }}
                        onPress={() => !selected && saveSetting('default', { default_tax_class_id: c.id }, { default_tax_class_id: c.id }, `Default class: ${c.name}`)}
                        style={({ hovered }: any) => [{
                          minHeight: 44, paddingHorizontal: 14, justifyContent: 'center', borderRadius: 10, borderWidth: 1.5,
                          borderColor: selected ? colors.primary : colors.border,
                          backgroundColor: selected ? colors.primarySoft : hovered ? colors.surfaceSunken : colors.surface,
                        }, Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}>
                        <Text variant="smallStrong" color={selected ? colors.primarySoftText : colors.text}>{c.name} · {formatRate(c.current_rate)}%</Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : (
                <Text variant="bodyStrong">{defaultClass ? `${defaultClass.name} · ${formatRate(defaultClass.current_rate)}%` : 'Not set'}</Text>
              )}
              <Text variant="small" tone="subtle">Items without their own tax class use this one. Changing it changes the tax on those items' new bills.</Text>
            </View>
            {data.products_without_class > 0 ? (
              <Callout tone="warning" icon="pricetags-outline" title={`${data.products_without_class} item${data.products_without_class === 1 ? ' has' : 's have'} no tax class`}
                action={editable && active.length ? <Button title="Assign classes" size="sm" variant="secondary" icon="git-merge-outline" onPress={() => setAssigning({})} /> : undefined}>
                {`They use the default class${defaultClass ? ` (${defaultClass.name}, ${formatRate(defaultClass.current_rate)}%)` : ''}, or an old per-item rate if one was set. Assign a class so the right GST is charged when rates change.`}
              </Callout>
            ) : null}
          </FormSection>

          {/* Classes */}
          <View style={{ gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <View style={{ flex: 1, minWidth: 220, gap: 2 }}>
                <Text variant="h3" accessibilityRole="header">Tax classes</Text>
                <Text variant="small" tone="muted">Groups of items taxed the same way. Tap a class to see its rate history or schedule a change.</Text>
              </View>
              {editable && active.length ? (
                <Button title="Assign to items" variant="secondary" icon="git-merge-outline" size="sm" onPress={() => setAssigning({})} />
              ) : null}
            </View>
            {classes.length ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }} onLayout={(e) => setGridWidth(e.nativeEvent.layout.width)}>
                {classes.map((c) => (
                  <View key={c.id} style={{ width: twoCol && gridWidth ? (gridWidth - 12) / 2 : '100%' }}>
                    <ClassCard taxClass={c} onPress={() => setDetailId(c.id)} />
                  </View>
                ))}
              </View>
            ) : (
              <Card>
                <EmptyState icon="calculator-outline" title="No tax classes yet" message="Add one from the GST library to start charging the right GST."
                  action={editable ? { label: 'Add tax class', icon: 'add', onPress: () => setAdding(true) } : undefined} />
              </Card>
            )}
          </View>
        </>,
      )}

      {detail ? (
        <ClassDetailSheet taxClass={detail} canEdit={canEdit} online={online} onClose={() => setDetailId(null)} onChanged={(o) => { setData(o); void syncNow(); }}
          onAssign={() => { setDetailId(null); setAssigning({ classId: detail.id }); }} />
      ) : null}
      {adding ? <AddClassSheet classes={classes} onClose={() => setAdding(false)} onCreated={(o) => setData(o)} /> : null}
      {assigning ? (
        <AssignSheet classes={classes} defaultClass={defaultClass} initialClassId={assigning.classId} onClose={() => setAssigning(null)}
          onDone={() => { setAssigning(null); void reload(); void syncNow(); }} />
      ) : null}
      <TopDialogHost />
    </>
  );
}

function ClassCard({ taxClass: c, onPress }: { taxClass: TaxClass; onPress: () => void }) {
  const next = upcomingRates(c)[0];
  return (
    <Card onPress={onPress} style={{ gap: 10, opacity: c.is_active ? 1 : 0.75, height: '100%' }}>
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text variant="bodyStrong" numberOfLines={2}>{c.name}</Text>
          <Text variant="small" tone="muted">{c.current_rate === null ? 'No rate yet' : describeComponents(c.current_components, c.current_rate)}</Text>
          <Text variant="small" tone="subtle">
            {[`${c.products} item${c.products === 1 ? '' : 's'}`, c.hsn_sac ? `HSN/SAC ${c.hsn_sac}` : null].filter(Boolean).join(' · ')}
          </Text>
        </View>
        <RatePill rate={c.current_rate} muted={!c.is_active} />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {c.is_default ? <Badge label="Default" tone="primary" icon="star" /> : null}
        {next ? <Badge label={`Upcoming change on ${formatEffective(next.effective_from, false)} (${formatRate(next.total_rate)}%)`} tone="warning" icon="time-outline" /> : null}
        {c.follow_preset ? <Badge label="Follows Tallyko GST library" tone="info" icon="sync" /> : null}
        {!c.is_active ? <Badge label="Turned off" tone="neutral" /> : null}
      </View>
    </Card>
  );
}
