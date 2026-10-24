/**
 * Pieces shared by the platform console screens: page frame, permission + connectivity hooks, labels and badges.
 */
import React, { useEffect } from 'react';
import { Platform, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import NetInfo from '@react-native-community/netinfo';
import { router, type Href } from 'expo-router';
import { create } from 'zustand';
import { platformApi, type AccessInfo, type AccessState, type BusinessStatus, type LimitKey, type PaymentMethod, type SubscriptionKind, type SubscriptionStatus } from '@/api/platform';
import type { BusinessType } from '@/api/types';
import { Badge, Text, type BadgeTone } from '@/components/ui';
import { useAuth } from '@/store/auth';
import { useLayout, useTheme } from '@/theme/ThemeProvider';

type IconName = keyof typeof Ionicons.glyphMap;

// ---------------------------------------------------------------------------
// Permissions & connectivity
// ---------------------------------------------------------------------------

/** Only super admins change data; support staff get a read-only console. */
export function useCanEdit(): boolean {
  return useAuth((s) => s.session?.accountType === 'platform' && s.session?.platformRole === 'super_admin');
}

/** The POS sync loop (which tracks connectivity there) doesn't run for platform logins, so the console watches the network itself. */
export const useAdminNet = create<{ online: boolean }>(() => ({ online: true }));

export function useWatchNetwork() {
  useEffect(() => NetInfo.addEventListener((state) => {
    useAdminNet.setState({ online: state.isConnected !== false && state.isInternetReachable !== false });
  }), []);
}

export function useOnline(): boolean {
  return useAdminNet((s) => s.online);
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

export const BUSINESS_TYPE_LABEL: Record<string, string> = {
  restaurant: 'Restaurant', cafe: 'Café', cloud_kitchen: 'Cloud kitchen', retail: 'Retail shop',
};
export const BUSINESS_TYPE_ICON: Record<string, IconName> = {
  restaurant: 'restaurant-outline', cafe: 'cafe-outline', cloud_kitchen: 'flame-outline', retail: 'storefront-outline',
};
export const BUSINESS_TYPES: BusinessType[] = ['restaurant', 'cafe', 'cloud_kitchen', 'retail'];

export const STATUS_LABEL: Record<BusinessStatus, string> = { active: 'Active', suspended: 'Suspended', deleted: 'Closed' };
const STATUS_TONE: Record<BusinessStatus, BadgeTone> = { active: 'success', suspended: 'danger', deleted: 'neutral' };

export const SUBSCRIPTION_LABEL: Record<SubscriptionStatus, string> = { none: 'No payment yet', active: 'Paid', expired: 'Expired' };
const SUBSCRIPTION_TONE: Record<SubscriptionStatus, BadgeTone> = { none: 'neutral', active: 'success', expired: 'warning' };

export const LIMIT_LABEL: Record<LimitKey, string> = { max_staff: 'Staff logins', max_products: 'Products', max_locations: 'Locations' };

export const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'upi', label: 'UPI' }, { value: 'bank_transfer', label: 'Bank transfer' }, { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' }, { value: 'cheque', label: 'Cheque' }, { value: 'free', label: 'Free / trial' }, { value: 'other', label: 'Other' },
];
export const PAYMENT_METHOD_LABEL = Object.fromEntries(PAYMENT_METHODS.map((m) => [m.value, m.label])) as Record<PaymentMethod, string>;

export const ACTION_LABEL: Record<string, string> = {
  'business.create': 'Onboarded business',
  'business.update': 'Changed business',
  'business.reset_owner_password': 'Reset owner password',
  'subscription.record': 'Recorded payment',
  'plan.save': 'Saved plan',
  'tax.preset_create': 'Added GST preset',
  'tax.publish_rate': 'Scheduled GST rate',
  'subscription.demo': 'Gave free demo',
  'subscription.development': 'Changed development access',
  'subscription.approve_request': 'Approved payment claim',
  'subscription.reject_request': 'Rejected payment claim',
  'subscription.lapsed': 'Locked: subscription ended',
  'subscription_offer.create': 'Created subscription offer',
  'subscription_offer.update': 'Changed subscription offer',
  'business.sign_out': 'Signed out all devices',
  'session.revoke': 'Signed out a device',
  'platform.settings': 'Changed platform settings',
  'jobs.subscription_check': 'Ran subscription check',
  'records.archive': 'Archived bills',
  'records.unarchive': 'Restored archived bills',
  'records.delete': 'Permanently deleted bills',
  'owner_request.resolve': 'Handled owner request',
};

export function actionLabel(action: string): string {
  return ACTION_LABEL[action] ?? action.replace(/[._]/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

export function StatusBadge({ status }: { status: BusinessStatus }) {
  return <Badge label={STATUS_LABEL[status] ?? status} tone={STATUS_TONE[status] ?? 'neutral'} />;
}

export function SubscriptionBadge({ status }: { status: SubscriptionStatus }) {
  return <Badge label={SUBSCRIPTION_LABEL[status] ?? status} tone={SUBSCRIPTION_TONE[status] ?? 'neutral'} />;
}

export const ACCESS_LABEL: Record<AccessState, string> = {
  trial: 'Demo', development: 'Development', active: 'Active', grace: 'Grace', lapsed: 'Locked',
};
const ACCESS_TONE: Record<AccessState, BadgeTone> = { trial: 'info', development: 'accent', active: 'success', grace: 'warning', lapsed: 'danger' };
const ACCESS_ICON: Record<AccessState, IconName> = {
  trial: 'hourglass-outline', development: 'construct-outline', active: 'checkmark-circle-outline', grace: 'alert-circle-outline', lapsed: 'lock-closed',
};

export const KIND_LABEL: Record<SubscriptionKind, string> = { trial: 'Free demo', paid: 'Paid', complimentary: 'Complimentary', development: 'Development' };
export const KIND_TONE: Record<SubscriptionKind, BadgeTone> = { trial: 'info', paid: 'success', complimentary: 'accent', development: 'accent' };

/** Demo / Development / Active / Grace / Locked, optionally with the days left. */
export function AccessBadge({ access, days = false }: { access: AccessInfo | null | undefined; days?: boolean }) {
  if (!access) return null;
  const left = access.days_left;
  const suffix = days && access.state !== 'lapsed' && access.state !== 'development' && left !== null && left !== undefined ? ` · ${left} d` : '';
  return <Badge label={`${ACCESS_LABEL[access.state] ?? access.state}${suffix}`} tone={ACCESS_TONE[access.state] ?? 'neutral'} icon={ACCESS_ICON[access.state]} />;
}

/** "14 days left", "No expiry", "Locked" ... */
export function accessDaysText(access: AccessInfo | null | undefined): string {
  if (!access) return '';
  if (access.state === 'development') return 'No expiry';
  if (access.state === 'lapsed') return 'Locked';
  const d = access.days_left ?? 0;
  if (access.state === 'grace') return 'Paid period over';
  return d === 0 ? 'Ends today' : `${d} day${d === 1 ? '' : 's'} left`;
}

export function plural(n: number, word: string, many = `${word}s`): string {
  return `${n.toLocaleString('en-IN')} ${n === 1 ? word : many}`;
}

export function PlanBadge({ name }: { name: string }) {
  return <Badge label={name} tone="primary" icon="pricetag-outline" />;
}

export function limitText(value: number | null | undefined): string {
  return value === null || value === undefined ? 'Unlimited' : value.toLocaleString('en-IN');
}

/** "3 Nov 2026"; an em dash when there is no date. */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function daysUntil(iso: string | null | undefined, now = Date.now()): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - now) / 86_400_000);
}

/**
 * Midnight in India (IST, UTC+05:30) for a YYYY-MM-DD date, as a UTC ISO string.
 * GST changes take effect from the start of the day in India.
 */
export function istMidnightIso(date: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const utc = Date.UTC(y, mo - 1, d);
  const check = new Date(utc);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  return new Date(utc - 330 * 60_000).toISOString();
}

/** Today's date in India as YYYY-MM-DD (offset by `days`). */
export function istDate(days = 0): string {
  return new Date(Date.now() + 330 * 60_000 + days * 86_400_000).toISOString().slice(0, 10);
}

export function goTo(href: string) {
  router.push(href as Href);
}

// ---------------------------------------------------------------------------
// Pending work for the nav badges: payment claims and owner requests
// ---------------------------------------------------------------------------

/** Owners' "I've paid" claims waiting for review; shown as a badge on the Payments nav item. */
export const usePendingPayments = create<{ count: number | null }>(() => ({ count: null }));
/** Owners' archive / delete requests waiting for Tallyko; badge on the Owner requests nav item. */
export const usePendingOwnerRequests = create<{ count: number | null }>(() => ({ count: null }));

export function setPendingPayments(count: number) {
  usePendingPayments.setState({ count });
}

export function setPendingOwnerRequests(count: number) {
  usePendingOwnerRequests.setState({ count });
}

/** Refreshes both badge counts; keeps the last known counts when offline or on a transient error. */
export async function refreshPendingPayments(): Promise<void> {
  await Promise.all([
    platformApi.paymentRequests('pending').then((rows) => setPendingPayments(rows.length)).catch(() => undefined),
    platformApi.ownerRequests('pending').then((rows) => setPendingOwnerRequests(rows.length)).catch(() => undefined),
  ]);
}

export const BILL_STATUS_LABEL: Record<string, string> = {
  placed: 'Placed', open: 'Running', completed: 'Paid', cancelled: 'Cancelled', merged: 'Merged',
};
export const BILL_STATUS_TONE: Record<string, BadgeTone> = {
  placed: 'info', open: 'warning', completed: 'success', cancelled: 'neutral', merged: 'neutral',
};

// ---------------------------------------------------------------------------
// Page frame
// ---------------------------------------------------------------------------

/**
 * Standard console page: title row (+ optional back button and actions), offline strip, scrolling width-capped body.
 * The console shell (AdminLayout) already handles the top safe area on phones.
 */
export function AdminPage({ title, subtitle, actions, back, children, refreshing, onRefresh, maxWidth = 1200, footer, toolbar }: {
  title: string; subtitle?: string; actions?: React.ReactNode; back?: { label: string; onPress: () => void }; children: React.ReactNode;
  refreshing?: boolean; onRefresh?: () => void; maxWidth?: number; footer?: React.ReactNode; toolbar?: React.ReactNode;
}) {
  const { colors } = useTheme();
  const { isPhone } = useLayout();
  const pad = isPhone ? 16 : 28;
  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <OfflineStrip />
      <ScrollView
        contentContainerStyle={{ paddingBottom: 48, flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.primary} /> : undefined}
      >
        <View style={{ width: '100%', maxWidth: maxWidth + pad * 2, alignSelf: 'center', paddingHorizontal: pad, paddingTop: isPhone ? 14 : 24, gap: 20 }}>
          <View style={styles.header}>
            {back ? (
              <Pressable onPress={back.onPress} accessibilityRole="link" accessibilityLabel={back.label}
                style={({ hovered }: any) => [styles.back, hovered && { opacity: 0.75 }, Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}>
                <Ionicons name="arrow-back" size={16} color={colors.textMuted} />
                <Text variant="smallStrong" tone="muted">{back.label}</Text>
              </Pressable>
            ) : null}
            <View style={styles.titleRow}>
              <View style={{ flex: 1, minWidth: 220 }}>
                <Text variant={isPhone ? 'h1' : 'display'} accessibilityRole="header" numberOfLines={2}>{title}</Text>
                {subtitle ? <Text tone="muted" numberOfLines={3}>{subtitle}</Text> : null}
              </View>
              {actions ? <View style={styles.actions}>{actions}</View> : null}
            </View>
            {toolbar}
          </View>
          {children}
        </View>
      </ScrollView>
      {footer}
    </View>
  );
}

/**
 * Console page for one long list (businesses, payment claims, owner requests): title row and toolbar on top, then a
 * virtualised DataList that fills the rest of the height and scrolls by itself.
 */
export function AdminListFrame({ title, subtitle, actions, toolbar, children, below }: {
  title: string; subtitle?: string; actions?: React.ReactNode; toolbar?: React.ReactNode; children: React.ReactNode; below?: React.ReactNode;
}) {
  const { colors, radius } = useTheme();
  const { isPhone } = useLayout();
  const pad = isPhone ? 12 : 24;
  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <OfflineStrip />
      <View style={{ flex: 1, minHeight: 0, paddingHorizontal: pad, paddingTop: isPhone ? 12 : 20, paddingBottom: 12, gap: 12 }}>
        <View style={styles.titleRow}>
          <View style={{ flex: 1, minWidth: 200 }}>
            <Text variant={isPhone ? 'h1' : 'display'} accessibilityRole="header" numberOfLines={1}>{title}</Text>
            {subtitle ? <Text tone="muted" numberOfLines={isPhone ? 2 : 1}>{subtitle}</Text> : null}
          </View>
          {actions ? <View style={styles.actions}>{actions}</View> : null}
        </View>
        {toolbar}
        <View style={{ flex: 1, minHeight: 0, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.surface }}>
          {children}
        </View>
        {below}
      </View>
    </View>
  );
}

export function OfflineStrip() {
  const { colors } = useTheme();
  const online = useOnline();
  if (online) return null;
  return (
    <View accessibilityRole="alert" style={{ backgroundColor: colors.warningSoft, paddingVertical: 8, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Ionicons name="cloud-offline" size={16} color={colors.warningText} />
      <Text variant="smallStrong" color={colors.warningText} style={{ flex: 1 }}>
        You're offline. The console shows the last loaded data; changes can't be saved until you're back online.
      </Text>
    </View>
  );
}

/** Small banner shown to `support` users on screens with editing controls. */
export function ReadOnlyNote({ what = 'make changes' }: { what?: string }) {
  const { colors, radius } = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', padding: 10, paddingHorizontal: 12, borderRadius: radius.md, backgroundColor: colors.surfaceSunken }}>
      <Ionicons name="eye-outline" size={16} color={colors.textMuted} />
      <Text variant="small" tone="muted" style={{ flex: 1 }}>Read-only access. Only a super admin can {what}.</Text>
    </View>
  );
}

/** Horizontal share bar used by the overview breakdowns. */
export function ShareBar({ label, value, total, color, icon }: { label: string; value: number; total: number; color?: string; icon?: IconName }) {
  const { colors, radius } = useTheme();
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <View style={{ gap: 6 }} accessibilityLabel={`${label}: ${value} (${pct}%)`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {icon ? <Ionicons name={icon} size={16} color={colors.textMuted} /> : null}
        <Text variant="smallStrong" style={{ flex: 1 }} numberOfLines={1}>{label}</Text>
        <Text variant="smallStrong">{value.toLocaleString('en-IN')}</Text>
        <Text variant="small" tone="subtle" style={{ width: 40, textAlign: 'right' }}>{pct}%</Text>
      </View>
      <View style={{ height: 8, borderRadius: radius.pill, backgroundColor: colors.surfaceSunken, overflow: 'hidden' }}>
        <View style={{ width: `${Math.max(pct, value > 0 ? 2 : 0)}%`, height: '100%', borderRadius: radius.pill, backgroundColor: color ?? colors.primary }} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { gap: 10 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', minHeight: 32 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
});
