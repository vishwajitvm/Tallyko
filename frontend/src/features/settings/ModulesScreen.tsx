/**
 * Modules & plan (owner only): what the business's plan includes, its limits, and switches to hide
 * modules the owner doesn't use. Modules outside the plan can't be turned on here ("Contact Tallyko to upgrade").
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Switch, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { errorMessage } from '@/api/client';
import { teamApi, type ModuleInfo, type ModulesInfo } from '@/api/access';
import { Badge, Card, EmptyState, ErrorState, Loading, Text, toast } from '@/components/ui';
import { useApi } from '@/hooks/useApi';
import { useNet } from '@/lib/sync';
import { useAccess, useAccessInfo } from '@/store/access';
import { useAuth } from '@/store/auth';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import { SettingsFrame } from './SettingsFrame';
import { Callout, SaveBar } from './components';

type IconName = keyof typeof Ionicons.glyphMap;

const META: Record<string, { icon: IconName; blurb: string }> = {
  tables: { icon: 'grid-outline', blurb: 'Floor plan, running tables, transfers and waiter assignment.' },
  kitchen: { icon: 'flame-outline', blurb: 'Kitchen display and KOT printing.' },
  online_orders: { icon: 'bicycle-outline', blurb: 'Swiggy, Zomato, ONDC and magicpin orders in one place.' },
  qr_ordering: { icon: 'qr-code-outline', blurb: 'Guests scan a QR on the table and order from their phone.' },
  online_store: { icon: 'storefront-outline', blurb: 'Your own ordering website with no commission.' },
  inventory: { icon: 'cube-outline', blurb: 'Stock levels, purchases, wastage and low-stock alerts.' },
  customers: { icon: 'people-circle-outline', blurb: 'Customer list, order history and contact details.' },
  loyalty: { icon: 'gift-outline', blurb: 'Points on every bill and rewards to redeem.' },
  offers: { icon: 'pricetag-outline', blurb: 'Discounts, happy hours and combo offers.' },
  email: { icon: 'mail-outline', blurb: 'Receipt, reward and offer emails to customers.' },
  brands: { icon: 'pricetags-outline', blurb: 'Run several virtual brands from one kitchen.' },
  staff: { icon: 'people-outline', blurb: 'Separate logins for cashiers, waiters and kitchen.' },
  custom_roles: { icon: 'shield-half-outline', blurb: 'Create your own roles and pick their permissions.' },
  reports: { icon: 'bar-chart-outline', blurb: 'Daily sales, payments, GST and item reports.' },
  advanced_reports: { icon: 'podium-outline', blurb: 'Staff performance, item and wastage reports, exports.' },
  menu_ocr: { icon: 'camera-outline', blurb: 'Build your menu from a photo of the menu card.' },
  integrations: { icon: 'git-network-outline', blurb: 'Webhooks and connections to other apps.' },
  audit_log: { icon: 'time-outline', blurb: 'Who cancelled bills, gave discounts or changed settings.' },
};

const GROUPS: { title: string; keys: string[] }[] = [
  { title: 'Selling', keys: ['tables', 'kitchen', 'online_orders', 'qr_ordering', 'online_store', 'brands'] },
  { title: 'Customers & marketing', keys: ['customers', 'loyalty', 'offers', 'email'] },
  { title: 'Back office', keys: ['inventory', 'reports', 'advanced_reports', 'menu_ocr', 'integrations'] },
  { title: 'Team & control', keys: ['staff', 'custom_roles', 'audit_log'] },
];

const LIMITS: { key: string; label: string; icon: IconName }[] = [
  { key: 'max_staff', label: 'Staff logins', icon: 'people-outline' },
  { key: 'max_products', label: 'Menu items', icon: 'restaurant-outline' },
  { key: 'max_locations', label: 'Branches', icon: 'business-outline' },
];

/** Modules whose screens need another module (their permissions/endpoints are gated by it on the server). */
const DEPENDS_ON: Record<string, string> = { custom_roles: 'staff', advanced_reports: 'reports' };

export default function ModulesScreen() {
  const sessionRole = useAuth((s) => s.session?.role ?? null);
  const access = useAccessInfo();
  const isOwner = (access?.role ?? sessionRole) === 'owner';
  if (!isOwner) {
    return (
      <SettingsFrame active="modules" title="Modules & plan">
        <EmptyState icon="lock-closed-outline" title="Owner only" message="Only the owner can see the plan and choose which modules the business uses." />
      </SettingsFrame>
    );
  }
  return <Modules />;
}

function Modules() {
  const { isPhone } = useLayout();
  const online = useNet((s) => s.online && s.serverReachable);
  const q = useApi(() => teamApi.modules(), []);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const serverHidden = useMemo(() => new Set((q.data?.modules ?? []).filter((m) => m.hidden).map((m) => m.key)), [q.data]);
  // Follow the server (e.g. a refetch on focus) unless the owner has unsaved changes.
  const baseRef = useRef('');
  useEffect(() => {
    const key = (set: Set<string>) => [...set].sort().join(',');
    const previousBase = baseRef.current;
    baseRef.current = key(serverHidden);
    setHidden((cur) => (key(cur) === previousBase ? new Set(serverHidden) : cur));
  }, [serverHidden]);

  const dirty = [...hidden].sort().join(',') !== [...serverHidden].sort().join(',');
  const byKey = useMemo(() => new Map((q.data?.modules ?? []).map((m) => [m.key, m])), [q.data]);
  const grouped = useMemo(() => {
    const known = new Set(GROUPS.flatMap((g) => g.keys));
    const groups = GROUPS.map((g) => ({ title: g.title, modules: g.keys.map((k) => byKey.get(k)).filter((m): m is ModuleInfo => !!m) }));
    const other = (q.data?.modules ?? []).filter((m) => !known.has(m.key));
    if (other.length) groups.push({ title: 'Other', modules: other });
    return groups.filter((g) => g.modules.length);
  }, [byKey, q.data]);

  const inPlan = (q.data?.modules ?? []).filter((m) => m.in_plan);
  const usedCount = inPlan.filter((m) => !hidden.has(m.key)).length;
  const missing = (q.data?.modules ?? []).filter((m) => !m.in_plan).length;

  const toggle = (key: string, on: boolean) => setHidden((s) => {
    const n = new Set(s);
    if (on) n.delete(key); else n.add(key);
    return n;
  });

  const save = async () => {
    setSaving(true);
    try {
      // Only modules in the plan can be hidden or shown; send the full hidden list.
      const saved: ModulesInfo = await teamApi.updateModules([...hidden].filter((k) => byKey.get(k)?.in_plan));
      q.setData(saved);
      await useAccess.getState().refresh();
      toast.success('Modules updated. The menu now shows only what you use.');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsFrame
      active="modules"
      title="Modules & plan"
      subtitle="Your plan and the parts of Tallyko your business uses. Hide what you don't need to keep the app simple for your staff."
      onRefresh={q.reload}
      refreshing={q.refreshing}
      dirty={dirty}
      footer={<SaveBar visible={dirty} saving={saving} onSave={save} onDiscard={() => setHidden(new Set(serverHidden))} disabled={!online}
        message={online ? 'You have unsaved module changes' : "You're offline. Connect to save."} />}
    >
      {q.loading && !q.data ? <Loading label="Loading your plan" /> : null}
      {q.error && !q.data ? <ErrorState message={q.error} onRetry={q.reload} /> : null}

      {q.data ? (
        <>
          <PlanCard data={q.data} usedCount={usedCount} inPlanCount={inPlan.length} missing={missing} />

          <Callout tone="neutral" icon="eye-off-outline">
            Hiding a module removes its screens and buttons for everyone. Your data is kept, and you can turn it back on any time.
          </Callout>

          {grouped.map((g) => (
            <View key={g.title} style={{ gap: 8 }}>
              <Text variant="caption" tone="subtle" style={{ textTransform: 'uppercase' }}>{g.title}</Text>
              <Card padded={false} style={{ overflow: 'hidden' }}>
                {g.modules.map((m, i) => {
                  const parent = DEPENDS_ON[m.key];
                  const parentOff = !!parent && (hidden.has(parent) || byKey.get(parent)?.in_plan === false);
                  return (
                    <ModuleRow key={m.key} module={m} first={i === 0} on={m.in_plan && !hidden.has(m.key)} compact={isPhone}
                      note={m.in_plan && parentOff && !hidden.has(m.key) ? `Works only while ${byKey.get(parent!)?.name ?? parent} is on.` : undefined}
                      onChange={(v) => toggle(m.key, v)} disabled={saving} />
                  );
                })}
              </Card>
            </View>
          ))}
        </>
      ) : null}
    </SettingsFrame>
  );
}

function PlanCard({ data, usedCount, inPlanCount, missing }: { data: ModulesInfo; usedCount: number; inPlanCount: number; missing: number }) {
  const { colors } = useTheme();
  const { isPhone } = useLayout();
  const limitText = (v: number | null | undefined) => (v === null || v === undefined ? 'Unlimited' : v.toLocaleString('en-IN'));
  return (
    <Card style={{ gap: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="ribbon-outline" size={22} color={colors.primarySoftText} />
        </View>
        <View style={{ flex: 1, minWidth: 160 }}>
          <Text variant="small" tone="muted">Your plan</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Text variant="h2">{data.plan_name}</Text>
            <Badge label={`${usedCount} of ${inPlanCount} modules in use`} tone="primary" />
          </View>
        </View>
      </View>
      <View style={{ flexDirection: isPhone ? 'column' : 'row', gap: isPhone ? 10 : 12 }}>
        {LIMITS.map((l) => (
          <View key={l.key} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 10, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border }}>
            <Ionicons name={l.icon} size={18} color={colors.textMuted} />
            <View style={{ flex: 1 }}>
              <Text variant="small" tone="muted">{l.label}</Text>
              <Text variant="bodyStrong">{limitText(data.limits[l.key])}</Text>
            </View>
          </View>
        ))}
      </View>
      {missing ? (
        <Callout tone="info" icon="sparkles-outline" title={`${missing} module${missing === 1 ? ' is' : 's are'} not in your plan`}>
          Contact Tallyko to upgrade if you need them.
        </Callout>
      ) : null}
    </Card>
  );
}

function ModuleRow({ module: m, first, on, onChange, disabled, note, compact }: {
  module: ModuleInfo; first: boolean; on: boolean; onChange: (v: boolean) => void; disabled?: boolean; note?: string; compact?: boolean;
}) {
  const { colors } = useTheme();
  const meta = META[m.key];
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, minHeight: 64, borderTopWidth: first ? 0 : 1, borderTopColor: colors.divider, opacity: m.in_plan ? 1 : 0.85 }}>
      <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: on ? colors.primarySoft : colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={meta?.icon ?? 'apps-outline'} size={18} color={on ? colors.primarySoftText : colors.textSubtle} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Text variant="bodyStrong" tone={m.in_plan ? 'default' : 'muted'}>{m.name}</Text>
          {!m.in_plan ? <Badge label="Not in your plan" icon="lock-closed-outline" /> : null}
        </View>
        {meta?.blurb && !(compact && !m.in_plan) ? <Text variant="small" tone="muted">{meta.blurb}</Text> : null}
        {!m.in_plan ? <Text variant="small" tone="subtle">Contact Tallyko to upgrade.</Text> : null}
        {note ? <Text variant="small" tone="warning">{note}</Text> : null}
      </View>
      <Switch
        value={on}
        onValueChange={onChange}
        disabled={disabled || !m.in_plan}
        trackColor={{ true: colors.primary, false: colors.borderStrong }}
        thumbColor="#FFFFFF"
        accessibilityLabel={m.in_plan ? `Use ${m.name}` : `${m.name}, not in your plan`}
      />
    </View>
  );
}
