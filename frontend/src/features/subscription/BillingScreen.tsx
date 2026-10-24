/**
 * Settings → Plan & billing (owner): current plan and state, days left, payment claims, history,
 * and the same renewal flow as the lock screen — while the business is still running.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { errorMessage } from '@/api/client';
import { Badge, Button, Card, EmptyState, ErrorState, Loading, Text } from '@/components/ui';
import { SettingsFrame } from '@/features/settings/SettingsFrame';
import { Callout, FormSection } from '@/features/settings/components';
import { formatDate } from '@/lib/format';
import { useAuth } from '@/store/auth';
import { useSubscription } from '@/store/subscription';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import { HistoryList, RenewFlow, RequestsList, SupportLinks } from './RenewFlow';
import { KIND_LABEL, STATE_LABEL, STATE_TONE, daysText, liveDaysLeft, monthsText, currentPeriod } from './format';

function SummaryTile({ label, value, hint, icon }: { label: string; value: string; hint?: string; icon: React.ComponentProps<typeof Ionicons>['name'] }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexGrow: 1, flexBasis: 180, minWidth: 0, gap: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Ionicons name={icon} size={15} color={colors.textMuted} />
        <Text variant="caption" tone="muted" style={{ textTransform: 'uppercase' }}>{label}</Text>
      </View>
      <Text variant="h2" numberOfLines={1}>{value}</Text>
      {hint ? <Text variant="small" tone="muted" numberOfLines={2}>{hint}</Text> : null}
    </View>
  );
}

export default function BillingScreen() {
  const role = useAuth((s) => s.session?.role ?? null);
  const info = useSubscription((s) => s.info);
  const { isPhone } = useLayout();
  const [loading, setLoading] = useState(!info);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renewOpen, setRenewOpen] = useState(false);

  const load = useCallback(async (mode: 'initial' | 'refresh' | 'silent' = 'silent') => {
    if (mode === 'refresh') setRefreshing(true);
    try {
      await useSubscription.getState().refresh();
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (role === 'owner') void load('initial');
  }, [role, load]);

  if (role !== 'owner') {
    return (
      <SettingsFrame active="billing" title="Plan & billing">
        <EmptyState icon="lock-closed-outline" title="Only the owner can manage the plan" message="Ask the owner of this business to renew or change the Tallyko plan." />
      </SettingsFrame>
    );
  }

  const left = liveDaysLeft(info);
  const period = info ? currentPeriod(info.history) : null;
  const pending = info?.requests.filter((r) => r.status === 'pending') ?? [];
  const rejected = info?.requests.find((r) => r.status === 'rejected');
  const showRenewOpen = renewOpen || (!!info && (info.state === 'trial' || info.state === 'grace' || (left !== null && left <= 14)));

  return (
    <SettingsFrame active="billing" title="Plan & billing" subtitle="Your Tallyko subscription, renewals and payments."
      refreshing={refreshing} onRefresh={() => void load('refresh')}
      actions={info ? <Button title="Refresh" icon="refresh" variant="ghost" size="sm" onPress={() => void load('refresh')} loading={refreshing} /> : undefined}>
      {loading && !info ? <Loading label="Loading your plan…" /> : null}
      {error && !info ? <ErrorState message={error} onRetry={() => void load('refresh')} /> : null}

      {info ? (
        <>
          <Card style={{ gap: 16 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <Text variant="h2" style={{ flexShrink: 1 }}>{info.plan_name} plan</Text>
              <Badge label={STATE_LABEL[info.state]} tone={STATE_TONE[info.state]} icon={info.state === 'development' ? 'construct-outline' : undefined} />
              {info.kind && info.kind !== 'development' && info.kind !== 'trial' ? <Badge label={KIND_LABEL[info.kind] ?? info.kind} tone="neutral" /> : null}
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: isPhone ? 14 : 24 }}>
              <SummaryTile icon="calendar-outline" label={info.state === 'grace' ? 'Ended on' : 'Valid until'}
                value={info.state === 'development' ? 'No expiry' : info.paid_until ? formatDate(info.paid_until) : '—'}
                hint={info.state === 'grace' && info.lock_at ? `Access stops on ${formatDate(info.lock_at)}` : undefined} />
              <SummaryTile icon="hourglass-outline" label="Days left"
                value={info.state === 'development' ? '—' : left === null ? '—' : left <= 0 ? 'Ends today' : String(left)}
                hint={info.state === 'development' ? 'Development access' : left !== null && left > 0 ? daysText(left) : undefined} />
              <SummaryTile icon="receipt-outline" label="Current period"
                value={period ? (period.months ? monthsText(period.months) : KIND_LABEL[period.kind] ?? period.kind) : '—'}
                hint={period ? `${formatDate(period.start_date)} – ${formatDate(period.end_date)}` : undefined} />
            </View>
            {info.state === 'development' ? (
              <Callout tone="info" icon="construct-outline" title="Development access">
                Tallyko switched this business on without an end date (for testing or a pilot). Nothing to pay while it lasts.
              </Callout>
            ) : info.state === 'grace' ? (
              <Callout tone="danger" title="Payment due">
                {`Your subscription ended${info.paid_until ? ` on ${formatDate(info.paid_until)}` : ''}. Renew before ${info.lock_at ? formatDate(info.lock_at) : 'access stops'} to keep billing without interruption.`}
              </Callout>
            ) : info.state === 'trial' ? (
              <Callout tone="info" title="You're on the free demo">
                {`Everything is switched on during the demo${left !== null ? ` (${daysText(left)})` : ''}. Pick a plan any time — your menu, bills and customers carry over.`}
              </Callout>
            ) : null}
          </Card>

          {pending.length || rejected ? (
            <FormSection title="Payments" description="Payments you told us about. Tallyko confirms them and extends your plan.">
              {pending.length ? (
                <Callout tone="info" title="Waiting for confirmation">Your plan is extended as soon as Tallyko confirms the payment. You don't need to send it again.</Callout>
              ) : null}
              <RequestsList requests={info.requests} plans={info.plans} />
            </FormSection>
          ) : null}

          {/* Development access has no end date (a renewal would start after it), so there is nothing to buy until Tallyko removes it */}
          {info.can_pay && info.state !== 'development' ? (
            <View style={{ gap: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <View style={{ flex: 1, minWidth: 200 }}>
                  <Text variant="h3" accessibilityRole="header">Renew or change plan</Text>
                  <Text variant="small" tone="muted">A renewal starts when the current period ends, so you never lose paid days.</Text>
                </View>
                {!showRenewOpen ? <Button title="Renew now" icon="card-outline" onPress={() => setRenewOpen(true)} /> : null}
              </View>
              {showRenewOpen ? <RenewFlow info={info} onSubmitted={() => void load('silent')} allowTwoColumns={false} /> : null}
            </View>
          ) : null}

          <FormSection title="History" description="Demo, paid and complimentary periods of this business.">
            <HistoryList history={info.history} />
          </FormSection>

          <FormSection title="Billing support" description="Questions about plans or payments.">
            <SupportLinks payment={info.payment} />
          </FormSection>
        </>
      ) : null}
    </SettingsFrame>
  );
}
