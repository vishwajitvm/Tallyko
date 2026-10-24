/**
 * Table QR: the customer tapped "I've paid by UPI". Staff check the shop's UPI app, then Confirm (records the UPI payment
 * and closes the bill if it covers it) or Not received (the customer is asked to pay again or at the counter).
 */
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Order } from '@/api/types';
import { floorApi, paymentClaimOf, type WithClaim } from '@/api/floor';
import { errorMessage } from '@/api/client';
import { Button, StatusPill, Text, confirm, toast } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { useAuth, can } from '@/store/auth';
import { useAccessInfo, useCan } from '@/store/access';
import { useNet } from '@/lib/sync';
import { formatTime, money } from '@/lib/format';

/** Who may confirm a claim: `orders.pay` (built-in role rules until /access/me has loaded). */
export function useCanConfirmPayments(): boolean {
  const role = useAuth((s) => s.session?.role ?? null);
  const info = useAccessInfo();
  const allowed = useCan('orders.pay');
  return info ? allowed : can(role, 'bill');
}

export function PaymentClaimBanner({ order, currency = '₹', onChanged, compact }: {
  order: WithClaim<Order> | Order; currency?: string; onChanged: (order: WithClaim<Order>) => void; compact?: boolean;
}) {
  const { colors, radius } = useTheme();
  const claim = paymentClaimOf(order);
  const canConfirm = useCanConfirmPayments();
  const online = useNet((s) => s.online && s.serverReachable);
  const [busy, setBusy] = useState<'confirm' | 'reject' | null>(null);
  if (!claim) return null;
  // A QR order waiting to be accepted isn't in the kitchen yet: confirming would close it without a KOT
  const waiting = order.status === 'placed';

  const run = async (kind: 'confirm' | 'reject') => {
    if (kind === 'reject' && !(await confirm({
      title: 'Payment not received?',
      message: `The customer will be asked to pay ${money(claim.amount, currency)} again, or at the counter.`,
      confirmLabel: 'Not received', danger: true,
    }))) return;
    setBusy(kind);
    try {
      const updated = kind === 'confirm' ? await floorApi.confirmClaim(order.id) : await floorApi.rejectClaim(order.id);
      toast.success(kind === 'confirm'
        ? (updated.payment_status === 'paid' ? `UPI payment confirmed — bill ${updated.invoice_no ?? updated.code} closed` : 'UPI payment recorded')
        : 'Customer asked to pay again');
      onChanged({ ...updated, table_label: updated.table_label ?? order.table_label });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <View accessibilityRole="alert" style={[styles.banner, { backgroundColor: colors.waitingSoft, borderColor: colors.waiting, borderRadius: radius.md }]}>
      <View style={styles.head}>
        <Ionicons name="phone-portrait-outline" size={20} color={colors.waitingText} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="bodyStrong" color={colors.waitingText}>
            Customer says paid {money(claim.amount, currency)} by UPI
          </Text>
          <Text variant="small" color={colors.waitingText} numberOfLines={2}>
            {[claim.reference ? `Ref ${claim.reference}` : null, claim.at ? formatTime(claim.at) : null, 'Check your UPI app before confirming'].filter(Boolean).join(' · ')}
          </Text>
        </View>
      </View>
      {canConfirm && waiting ? <Text variant="small" color={colors.waitingText}>Accept the order first, then confirm the payment.</Text> : null}
      {canConfirm ? (
        <View style={styles.actions}>
          <Button title="Not received" variant="dangerOutline" icon="close" onPress={() => void run('reject')} loading={busy === 'reject'}
            disabled={!online || !!busy} style={compact ? { flex: 1 } : undefined} />
          <Button title={online ? 'Confirm' : 'Needs internet'} variant="success" icon={online ? 'checkmark' : 'cloud-offline-outline'}
            onPress={() => void run('confirm')} loading={busy === 'confirm'} disabled={!online || !!busy || waiting} style={compact ? { flex: 1 } : undefined}
            accessibilityLabel={`Confirm UPI payment of ${money(claim.amount, currency)}`} />
        </View>
      ) : (
        <Text variant="small" color={colors.waitingText}>A cashier or manager confirms UPI payments.</Text>
      )}
    </View>
  );
}

/** Small badge for lists and table cards. */
export function ClaimBadge() {
  return <StatusPill status="claim" label="UPI to confirm" />;
}

/** The customer's choice on the QR page, from the order notes ("Will pay by UPI" / "Will pay at the counter"). */
export function payChoice(notes: string | null | undefined): { label: string; rest: string | null } | null {
  if (!notes) return null;
  const lines = notes.split('\n');
  const hit = lines.find((l) => /^Will pay (by UPI|at the counter)$/i.test(l.trim()));
  if (!hit) return null;
  const rest = lines.filter((l) => l !== hit).join('\n').trim();
  return { label: hit.trim(), rest: rest || null };
}

const styles = StyleSheet.create({
  banner: { borderWidth: 1, padding: 12, gap: 10 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  actions: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' },
});
