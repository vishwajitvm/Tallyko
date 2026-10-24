/** Platform overview: how many businesses, which plans and types, revenue and renewals this month. */
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { platformApi } from '@/api/platform';
import { Button, Card, ErrorState, Loading, Stat, Text, type TextTone } from '@/components/ui';
import { useApi } from '@/hooks/useApi';
import { ago, money } from '@/lib/format';
import { useAuth } from '@/store/auth';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import { OnboardBusinessSheet } from './OnboardBusinessSheet';
import { AdminPage, BUSINESS_TYPE_ICON, BUSINESS_TYPE_LABEL, ShareBar, goTo, setPendingPayments, useCanEdit, usePendingOwnerRequests } from './shared';

export default function OverviewScreen() {
  const { colors } = useTheme();
  const { width } = useLayout();
  const canEdit = useCanEdit();
  const name = useAuth((s) => s.session?.fullName ?? null);
  const overview = useApi(() => platformApi.overview(), []);
  const plans = useApi(() => platformApi.plans(), []);
  const [onboarding, setOnboarding] = useState(false);
  const ownerRequests = usePendingOwnerRequests((s) => s.count);

  useEffect(() => {
    if (overview.data) setPendingPayments(overview.data.pending_payment_requests ?? 0);
  }, [overview.data]);

  const data = overview.data;
  const active = data?.businesses.active ?? 0;
  const suspended = data?.businesses.suspended ?? 0;
  const closed = data?.businesses.deleted ?? 0;
  const planName = (key: string) => plans.data?.plans.find((p) => p.key === key)?.name ?? key;
  const planOrder = (key: string) => plans.data?.plans.findIndex((p) => p.key === key) ?? 0;
  const byPlan = Object.entries(data?.by_plan ?? {}).sort((a, b) => planOrder(a[0]) - planOrder(b[0]));
  const byType = Object.entries(data?.by_type ?? {}).sort((a, b) => b[1] - a[1]);
  const typeTotal = byType.reduce((n, [, v]) => n + v, 0);
  const planColors = [colors.info, colors.primary, colors.accent, colors.success, colors.danger];
  const twoCol = width >= 980;
  const month = new Date().toLocaleDateString('en-IN', { month: 'long' });

  return (
    <AdminPage
      title="Overview"
      subtitle={`${name ? `Welcome back, ${name.split(' ')[0]}. ` : ''}Every business on Tallyko at a glance.`}
      refreshing={overview.refreshing}
      onRefresh={() => { void overview.reload(); void plans.reload(); }}
      actions={canEdit ? <Button title="Onboard business" icon="add" onPress={() => setOnboarding(true)} /> : null}
    >
      {overview.loading && !data ? <Loading label="Loading overview" /> : null}
      {overview.error && !data ? <ErrorState message={overview.error} onRetry={overview.reload} /> : null}

      {data ? (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
            <Stat label="Active businesses" value={active.toLocaleString('en-IN')} icon="storefront-outline"
              hint={closed ? `${closed} closed by owner` : 'Billing on Tallyko now'} />
            <Stat label="Suspended" value={suspended.toLocaleString('en-IN')} icon="pause-circle-outline" tone={suspended ? 'danger' : 'default'}
              hint={suspended ? 'Cannot sign in or bill' : 'None suspended'} />
            <Stat label="New this month" value={data.new_this_month.toLocaleString('en-IN')} icon="sparkles-outline" hint={`Signed up in ${month}`} />
            <Stat label="Revenue this month" value={money(data.revenue_this_month, '₹', true)} icon="wallet-outline" tone="success" hint="Recorded payments" />
            <Stat label="Renewals due in 7 days" value={data.renewals_due_7_days.toLocaleString('en-IN')} icon="alarm-outline"
              tone={data.renewals_due_7_days ? 'warning' : 'default'} hint="Paid-until ends soon" />
          </View>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
            <StatLink label="Locked" value={(data.locked ?? 0).toLocaleString('en-IN')} icon="lock-closed-outline" tone={data.locked ? 'danger' : 'default'}
              hint={data.locked ? 'Subscription ended · see renewal page' : 'Nobody is locked out'} onPress={() => goTo('/admin/businesses?access=locked')} />
            <StatLink label="Pending payments" value={(data.pending_payment_requests ?? 0).toLocaleString('en-IN')} icon="wallet-outline"
              tone={data.pending_payment_requests ? 'warning' : 'default'} hint={data.pending_payment_requests ? 'Owners say they paid · review' : 'No claims waiting'}
              onPress={() => goTo('/admin/payments')} />
            <StatLink label="Owner requests" value={(ownerRequests ?? 0).toLocaleString('en-IN')} icon="mail-unread-outline"
              tone={ownerRequests ? 'warning' : 'default'} hint={ownerRequests ? 'Archive / delete bills · review' : 'No requests waiting'}
              onPress={() => goTo('/admin/requests')} />
            <StatLink label="Daily check" icon="time-outline" onPress={() => goTo('/admin/settings')}
              value={data.last_subscription_check ? `${ago(data.last_subscription_check.last_run_at)} ago` : 'Never'}
              hint={data.last_subscription_check ? `${data.last_subscription_check.locked_now} locked · ${data.last_subscription_check.renewals_due_soon} due soon` : 'Runs at 01:00 India time'} />
          </View>

          <View style={{ flexDirection: twoCol ? 'row' : 'column', gap: 16, alignItems: 'flex-start' }}>
            <Card style={{ gap: 14, flex: twoCol ? 1 : undefined, alignSelf: 'stretch' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Text variant="h3">Active businesses by plan</Text>
                  <Text variant="small" tone="muted">Suspended and closed businesses are not counted.</Text>
                </View>
                <Button title="Plans" size="sm" variant="ghost" iconRight="chevron-forward" onPress={() => goTo('/admin/plans')} />
              </View>
              {byPlan.length === 0 ? <Text tone="muted">No active businesses yet.</Text> : null}
              {byPlan.map(([key, count], i) => (
                <ShareBar key={key} label={planName(key)} value={count} total={active} color={planColors[i % planColors.length]} icon="pricetag-outline" />
              ))}
            </Card>
            <Card style={{ gap: 14, flex: twoCol ? 1 : undefined, alignSelf: 'stretch' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Text variant="h3">Businesses by type</Text>
                  <Text variant="small" tone="muted">All signed-up businesses, including closed ones.</Text>
                </View>
                <Button title="Businesses" size="sm" variant="ghost" iconRight="chevron-forward" onPress={() => goTo('/admin/businesses')} />
              </View>
              {byType.length === 0 ? <Text tone="muted">No businesses yet.</Text> : null}
              {byType.map(([type, count]) => (
                <ShareBar key={type} label={BUSINESS_TYPE_LABEL[type] ?? type} value={count} total={typeTotal} icon={BUSINESS_TYPE_ICON[type] ?? 'business-outline'} />
              ))}
            </Card>
          </View>

          <Card style={{ gap: 4 }}>
            <Text variant="h3">Quick links</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
              <Button title="Suspended businesses" icon="pause-circle-outline" variant="secondary" size="sm" onPress={() => goTo('/admin/businesses?status=suspended')} />
              <Button title="GST rate library" icon="receipt-outline" variant="secondary" size="sm" onPress={() => goTo('/admin/tax')} />
              <Button title="Recent platform actions" icon="time-outline" variant="secondary" size="sm" onPress={() => goTo('/admin/audit')} />
            </View>
          </Card>
        </>
      ) : null}

      {onboarding ? (
        <OnboardBusinessSheet plans={plans.data?.plans ?? []} onClose={() => setOnboarding(false)} onDone={() => void overview.silentReload()} />
      ) : null}
    </AdminPage>
  );
}

/** A stat tile that opens a filtered view. */
function StatLink({ label, value, hint, icon, tone = 'default', onPress }: {
  label: string; value: string; hint?: string; icon: keyof typeof Ionicons.glyphMap; tone?: TextTone; onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Card onPress={onPress} style={{ flex: 1, minWidth: 180, gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Ionicons name={icon} size={16} color={colors.textSubtle} />
        <Text variant="small" tone="muted" numberOfLines={1} style={{ flex: 1 }}>{label}</Text>
        <Ionicons name="chevron-forward" size={16} color={colors.textSubtle} />
      </View>
      <Text variant="h1" tone={tone} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      {hint ? <Text variant="small" tone="subtle" numberOfLines={1}>{hint}</Text> : null}
    </Card>
  );
}
