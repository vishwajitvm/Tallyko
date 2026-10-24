/**
 * Renewal page shown instead of the app while the business's subscription has ended (HTTP 402 / login says `locked`).
 *
 * - Nothing is lost: the reassurance line counts this business's offline bills, which stay in the outbox and sync after renewal.
 * - The owner can renew right here (plans, offers, UPI / bank, "I've paid"); staff are asked to contact the owner.
 * - The page re-checks GET /subscription every 30 s, when the app returns to the foreground and after a claim, so it
 *   unlocks by itself as soon as Tallyko approves the payment.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, ScrollView, StyleSheet, View } from 'react-native';
import { Redirect, router, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { errorMessage } from '@/api/client';
import { Badge, Button, Card, Loading, Text, toast } from '@/components/ui';
import { Logo } from '@/components/Logo';
import { Callout } from '@/features/settings/components';
import { ROLE_LABEL } from '@/features/settings/sections';
import { endSession } from '@/lib/signOut';
import { formatDateTime } from '@/lib/format';
import { useAuth } from '@/store/auth';
import { useOutbox } from '@/store/outbox';
import { useSubscription } from '@/store/subscription';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import { RenewFlow, RequestsList, SupportLinks } from './RenewFlow';
import { lockHeadline } from './format';

const RECHECK_MS = 30_000;

/** Offline bills of this business that are still on the device. */
export function useSavedBills(): number {
  const tenantId = useAuth((s) => s.session?.tenantId);
  return useOutbox((s) => s.queue.filter((q) => q.tenantId === tenantId).length);
}

export function SafeDataLine({ count }: { count: number }) {
  return (
    <Callout tone="success" icon="shield-checkmark" title="Your data is safe">
      {count > 0
        ? `${count} offline bill${count === 1 ? ' is' : 's are'} saved on this device and will sync after renewal. Menu, customers, bills and reports are all kept.`
        : 'Menu, customers, bills and reports are all kept. Everything is back the moment you renew.'}
    </Callout>
  );
}

export default function LockScreen() {
  const { colors } = useTheme();
  const { isPhone, isDesktop } = useLayout();
  const insets = useSafeAreaInsets();
  const status = useAuth((s) => s.status);
  const session = useAuth((s) => s.session);
  const locked = useSubscription((s) => s.locked);
  const current = useSubscription((s) => s.current);
  const info = useSubscription((s) => s.info);
  const lockMessage = useSubscription((s) => s.lockMessage);
  const savedBills = useSavedBills();
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const check = useCallback(async (manual = false) => {
    if (manual) setChecking(true);
    try {
      const next = await useSubscription.getState().refresh();
      setError(null);
      if (manual && next.locked) toast.info(next.requests.some((r) => r.status === 'pending') ? 'Not confirmed yet. We will unlock as soon as it is.' : 'Still waiting for renewal.');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      if (manual) setChecking(false);
    }
  }, []);

  useEffect(() => {
    if (status !== 'signedIn') return undefined;
    void check();
    const timer = setInterval(() => void check(), RECHECK_MS);
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') void check(); });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [status, check]);

  // Unlocked (Tallyko approved the payment, or the lock was stale): straight back to work; sync resumes and uploads the outbox
  const sawLock = useRef(false);
  if (locked) sawLock.current = true;
  useEffect(() => {
    if (status !== 'signedIn' || locked) return;
    if (sawLock.current) toast.success('Your subscription is active again. Welcome back!');
    router.replace('/' as Href);
  }, [status, locked]);

  if (status !== 'signedIn' || !session) return <Redirect href="/login" />;
  if (session.accountType !== 'business') return <Redirect href="/" />;
  if (!locked) return <View style={[styles.root, { backgroundColor: colors.background }]}><Loading /></View>;

  const sub = info ?? current;
  const { title, subtitle } = lockHeadline(sub);
  const isOwner = session.role === 'owner';
  const canPay = info ? info.can_pay : isOwner;
  const pending = info?.requests.filter((r) => r.status === 'pending') ?? [];
  const latestRejected = info?.requests.find((r) => r.status === 'rejected');
  const pad = isPhone ? 16 : 32;

  const signOut = async () => {
    setSigningOut(true);
    try {
      await endSession();
      router.replace('/login' as Href);
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.topBar, { paddingTop: insets.top + 10, paddingHorizontal: pad, borderBottomColor: colors.border, backgroundColor: colors.surface }]}>
        <Logo size={isPhone ? 26 : 30} />
        <View style={{ flex: 1 }} />
        {!isPhone && session.businessName ? (
          <View style={{ alignItems: 'flex-end', marginRight: 4 }}>
            <Text variant="smallStrong" numberOfLines={1} style={{ maxWidth: 260 }}>{session.businessName}</Text>
            <Text variant="caption" tone="muted" numberOfLines={1}>{session.fullName || session.email} · {ROLE_LABEL[session.role] ?? session.role}</Text>
          </View>
        ) : null}
        <Button title="Sign out" icon="log-out-outline" variant="ghost" size="sm" onPress={signOut} loading={signingOut} />
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: pad, paddingTop: isPhone ? 16 : 28, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">
        <View style={{ width: '100%', maxWidth: isDesktop ? 1180 : 760, alignSelf: 'center', gap: 16 }}>
          <Card style={{ gap: 14 }}>
            <View style={{ flexDirection: isPhone ? 'column' : 'row', gap: 16, alignItems: isPhone ? 'flex-start' : 'center' }}>
              <View style={[styles.heroIcon, { backgroundColor: colors.warningSoft }]}>
                <Ionicons name="lock-closed" size={26} color={colors.warningText} />
              </View>
              <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <Text variant={isPhone ? 'h1' : 'display'} accessibilityRole="header" style={{ flexShrink: 1 }}>{title}</Text>
                </View>
                <Text tone="muted">{subtitle}</Text>
                {session.businessName && isPhone ? <Text variant="small" tone="subtle">{session.businessName}</Text> : null}
              </View>
              <Button title="Check again" icon="refresh" variant="secondary" size="sm" onPress={() => void check(true)} loading={checking} />
            </View>
            <SafeDataLine count={savedBills} />
            {lockMessage && !info ? <Text variant="small" tone="subtle">{lockMessage}</Text> : null}
            {error ? <Callout tone="warning" title="Could not check the subscription">{`${error} We will try again automatically.`}</Callout> : null}
          </Card>

          {pending.length && canPay ? (
            <Card style={{ gap: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Ionicons name="time-outline" size={20} color={colors.warningText} />
                <Text variant="h3" style={{ flex: 1 }}>Payment sent — waiting for confirmation</Text>
                <Badge label="Checking automatically" tone="info" icon="sync" />
              </View>
              <Text variant="small" tone="muted">
                Sent {formatDateTime(pending[0]!.created_at)}. This page unlocks by itself as soon as Tallyko confirms your payment — you don't need to restart the app.
              </Text>
              <RequestsList requests={pending} plans={info?.plans ?? []} />
            </Card>
          ) : null}

          {latestRejected && !pending.length && canPay ? (
            <Callout tone="danger" title="Your last payment was not approved">
              {`${latestRejected.review_note || 'Tallyko could not match the payment.'} Reference ${latestRejected.reference}. Check the details and send it again, or contact support.`}
            </Callout>
          ) : null}

          {!info && !error ? <Loading label="Loading plans…" /> : null}

          {info && canPay ? <RenewFlow info={info} onSubmitted={() => void check()} /> : null}

          {info && !canPay ? (
            <Card style={{ gap: 12, alignItems: 'flex-start' }}>
              <View style={[styles.heroIcon, { backgroundColor: colors.infoSoft, width: 44, height: 44 }]}>
                <Ionicons name="person-outline" size={22} color={colors.infoText} />
              </View>
              <Text variant="h2">Ask the owner to renew</Text>
              <Text tone="muted">
                Only the owner of {session.businessName || 'this business'} can renew the Tallyko subscription. Once they do, this screen unlocks
                by itself and billing continues where you left off.
              </Text>
              {pending.length ? <Badge label="The owner has already sent a payment" tone="info" icon="checkmark" /> : null}
            </Card>
          ) : null}

          {info && canPay && info.requests.some((r) => r.status !== 'pending') ? (
            <Card style={{ gap: 12 }}>
              <Text variant="h3">Earlier payments</Text>
              <RequestsList requests={info.requests.filter((r) => r.status !== 'pending')} plans={info.plans} limit={3} />
            </Card>
          ) : null}

          <Card style={{ gap: 10 }}>
            <Text variant="h3">Need help?</Text>
            <Text variant="small" tone="muted">Questions about plans, payments or GST invoices for your subscription — talk to Tallyko billing support.</Text>
            <SupportLinks payment={info?.payment} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
              <Button title="Sign out" icon="log-out-outline" variant="secondary" size="sm" onPress={signOut} loading={signingOut} />
            </View>
          </Card>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingBottom: 10, borderBottomWidth: 1 },
  heroIcon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
});
