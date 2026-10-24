/**
 * Shell of the Tallyko platform console (super admin / support). No POS here: businesses, payment claims, subscription offers,
 * plans, GST library, platform settings, audit.
 *  - Desktop (≥1100dp): full sidebar with logo, navigation and the signed-in admin.
 *  - Tablet: icon-only sidebar.
 *  - Phone: compact top bar + bottom tab bar (four items + "More").
 */
import React, { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Redirect, Stack, router, usePathname, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LogoMark } from '@/components/Logo';
import { ListRow, Sheet, Text } from '@/components/ui';
import { signOut } from '@/lib/signOut';
import { useAuth } from '@/store/auth';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import { useNavPrefs } from '@/components/nav/navPrefs';
import { refreshPendingPayments, useOnline, usePendingOwnerRequests, usePendingPayments, useWatchNetwork } from './shared';

type IconName = keyof typeof Ionicons.glyphMap;

interface AdminNavItem {
  key: string;
  label: string;
  short: string;
  href: string;
  icon: IconName;
  iconActive: IconName;
  /** In the phone bottom bar; the rest sit under "More" */
  tab?: boolean;
}

const NAV: AdminNavItem[] = [
  { key: 'overview', label: 'Overview', short: 'Overview', href: '/admin', icon: 'grid-outline', iconActive: 'grid', tab: true },
  { key: 'businesses', label: 'Businesses', short: 'Businesses', href: '/admin/businesses', icon: 'storefront-outline', iconActive: 'storefront', tab: true },
  { key: 'payments', label: 'Payment requests', short: 'Payments', href: '/admin/payments', icon: 'wallet-outline', iconActive: 'wallet', tab: true },
  { key: 'requests', label: 'Owner requests', short: 'Requests', href: '/admin/requests', icon: 'mail-unread-outline', iconActive: 'mail-unread' },
  { key: 'offers', label: 'Subscription offers', short: 'Offers', href: '/admin/offers', icon: 'pricetags-outline', iconActive: 'pricetags' },
  { key: 'plans', label: 'Plans & features', short: 'Plans', href: '/admin/plans', icon: 'layers-outline', iconActive: 'layers', tab: true },
  { key: 'tax', label: 'GST rate library', short: 'GST', href: '/admin/tax', icon: 'receipt-outline', iconActive: 'receipt' },
  { key: 'settings', label: 'Platform settings', short: 'Settings', href: '/admin/settings', icon: 'settings-outline', iconActive: 'settings' },
  { key: 'audit', label: 'Audit log', short: 'Audit', href: '/admin/audit', icon: 'time-outline', iconActive: 'time' },
];

/** Count badges per nav item (pending payment claims, pending owner requests). */
function useNavBadges(): Record<string, number> {
  const payments = usePendingPayments((s) => s.count);
  const requests = usePendingOwnerRequests((s) => s.count);
  const out: Record<string, number> = {};
  if (payments) out.payments = payments;
  if (requests) out.requests = requests;
  return out;
}

function NavBadge({ count, floating }: { count: number; floating?: boolean }) {
  const { colors, radius } = useTheme();
  return (
    <View accessibilityLabel={`${count} pending`}
      style={[
        { minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: radius.pill, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center' },
        floating && { position: 'absolute', top: 2, left: '50%', marginLeft: 4, minWidth: 18, height: 18, paddingHorizontal: 4 },
      ]}>
      <Text variant="caption" color={colors.primaryText}>{count > 99 ? '99+' : count}</Text>
    </View>
  );
}

const ROLE_LABEL = { super_admin: 'Super admin', support: 'Support · read-only' } as const;

function activeKey(pathname: string): string {
  const rest = pathname.replace(/^\/admin\/?/, '');
  if (!rest) return 'overview';
  return rest.split('/')[0] ?? 'overview';
}

import { initials } from '@/lib/initials';

function go(item: AdminNavItem) {
  router.navigate(item.href as Href);
}

export default function AdminLayout() {
  const { colors } = useTheme();
  const { isWide } = useLayout();
  const status = useAuth((s) => s.status);
  const session = useAuth((s) => s.session);
  useWatchNetwork();
  const signedIn = status === 'signedIn' && session?.accountType === 'platform';

  // Pending payment claims for the nav badge: on open, then every 2 minutes
  useEffect(() => {
    if (!signedIn) return undefined;
    void refreshPendingPayments();
    const id = setInterval(() => void refreshPendingPayments(), 120_000);
    return () => clearInterval(id);
  }, [signedIn]);

  if (status !== 'signedIn' || !session) return <Redirect href="/login" />;
  if (session.accountType !== 'platform') return <Redirect href="/" />;

  const stack = (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background }, animation: Platform.OS === 'web' ? 'none' : 'default' }} />
  );

  if (isWide) {
    return (
      <View style={{ flex: 1, flexDirection: 'row', backgroundColor: colors.background }}>
        <SideNav />
        <View style={{ flex: 1, minWidth: 0 }}>{stack}</View>
      </View>
    );
  }
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <TopBar />
      <View style={{ flex: 1 }}>{stack}</View>
      <BottomNav />
    </View>
  );
}

function useAdminIdentity() {
  const session = useAuth((s) => s.session);
  const name = session?.fullName || session?.email || 'Platform admin';
  const role = session?.platformRole ?? 'support';
  return { name, email: session?.email ?? '', role, roleLabel: ROLE_LABEL[role] };
}

function SideNav() {
  const { colors } = useTheme();
  const { isDesktop } = useLayout();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const active = activeKey(pathname);
  const online = useOnline();
  const me = useAdminIdentity();
  const badges = useNavBadges();
  const collapsed = useNavPrefs((s) => s.sidebarCollapsed);
  const compact = !isDesktop || collapsed;

  return (
    <View style={[styles.side, { backgroundColor: colors.sidebar, width: compact ? 84 : 256, paddingTop: insets.top + 18, paddingBottom: insets.bottom + 12 }]}
      accessibilityRole="menu">
      <View style={[styles.sideHeader, compact && { justifyContent: 'center', paddingHorizontal: 0 }]}>
        <LogoMark size={34} />
        {!compact ? (
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text variant="bodyStrong" color="#F8FAFC" numberOfLines={1}>Tallyko</Text>
            <Text variant="caption" color={colors.sidebarMuted} numberOfLines={1}>PLATFORM CONSOLE</Text>
          </View>
        ) : null}
      </View>

      <View style={{ flex: 1, paddingHorizontal: compact ? 10 : 12, gap: 2, marginTop: 22 }}>
        {!compact ? <Text variant="caption" color={colors.sidebarMuted} style={{ paddingHorizontal: 12, marginBottom: 4 }}>MANAGE TALLYKO</Text> : null}
        {NAV.map((item) => {
          const isActive = item.key === active;
          return (
            <Pressable key={item.key} onPress={() => go(item)} accessibilityRole="menuitem" accessibilityLabel={item.label} accessibilityState={{ selected: isActive }}
              style={({ hovered }: any) => [
                styles.sideItem,
                compact && { justifyContent: 'center', paddingHorizontal: 0 },
                { backgroundColor: isActive ? colors.sidebarActive : hovered ? 'rgba(255,255,255,0.05)' : 'transparent' },
                Platform.OS === 'web' && ({ cursor: 'pointer' } as any),
              ]}>
              <Ionicons name={isActive ? item.iconActive : item.icon} size={20} color={isActive ? colors.sidebarActiveText : colors.sidebarText} />
              {!compact ? <Text variant="smallStrong" color={isActive ? colors.sidebarActiveText : colors.sidebarText} style={{ flex: 1 }}>{item.label}</Text> : null}
              {badges[item.key] ? <NavBadge count={badges[item.key]!} floating={compact} /> : null}
            </Pressable>
          );
        })}
      </View>

      <View style={[styles.account, { borderTopColor: 'rgba(255,255,255,0.08)' }, compact && { flexDirection: 'column', paddingHorizontal: 0 }]}>
        <View style={[styles.avatar, { backgroundColor: colors.sidebarActive }]}>
          <Text variant="smallStrong" color={colors.sidebarActiveText}>{initials(me.name)}</Text>
        </View>
        {!compact ? (
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text variant="smallStrong" color={colors.sidebarText} numberOfLines={1}>{me.name}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={[styles.dot, { backgroundColor: online ? colors.success : colors.warning }]} />
              <Text variant="caption" color={me.role === 'super_admin' ? colors.sidebarActiveText : colors.sidebarMuted} numberOfLines={1}>{me.roleLabel}</Text>
            </View>
          </View>
        ) : null}
        <Pressable onPress={() => void signOut()} accessibilityRole="button" accessibilityLabel="Sign out"
          style={({ hovered }: any) => [styles.logout, hovered && { backgroundColor: 'rgba(255,255,255,0.08)' }, Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}>
          <Ionicons name="log-out-outline" size={20} color={colors.sidebarText} />
        </Pressable>
      </View>
      {isDesktop ? (
        <Pressable onPress={() => useNavPrefs.getState().set({ sidebarCollapsed: !collapsed })} accessibilityRole="button"
          accessibilityLabel={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          style={({ hovered }: any) => [styles.logout, { alignSelf: compact ? 'center' : 'flex-end', marginRight: compact ? 0 : 12, width: 36, height: 36 },
            hovered && { backgroundColor: 'rgba(255,255,255,0.08)' }, Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}>
          <Ionicons name={collapsed ? 'chevron-forward' : 'chevron-back'} size={18} color={colors.sidebarMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}

function TopBar() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const online = useOnline();
  const me = useAdminIdentity();
  return (
    <View style={[styles.top, { backgroundColor: colors.sidebar, paddingTop: insets.top + 8 }]}>
      <LogoMark size={30} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="smallStrong" color="#F8FAFC" numberOfLines={1}>Tallyko platform console</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={[styles.dot, { backgroundColor: online ? colors.success : colors.warning }]} />
          <Text variant="caption" color={colors.sidebarMuted} numberOfLines={1}>{me.name} · {me.roleLabel}</Text>
        </View>
      </View>
      <Pressable onPress={() => void signOut()} accessibilityRole="button" accessibilityLabel="Sign out"
        style={({ pressed }) => [styles.logout, pressed && { backgroundColor: 'rgba(255,255,255,0.08)' }]}>
        <Ionicons name="log-out-outline" size={22} color={colors.sidebarText} />
      </Pressable>
    </View>
  );
}

function BottomNav() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const active = activeKey(usePathname());
  const badges = useNavBadges();
  const [more, setMore] = useState(false);
  const tabs = NAV.filter((i) => i.tab);
  const rest = NAV.filter((i) => !i.tab);
  const moreActive = rest.some((i) => i.key === active);
  const restBadge = rest.reduce((n, i) => n + (badges[i.key] ?? 0), 0);
  return (
    <View style={[styles.bottom, { backgroundColor: colors.surface, borderTopColor: colors.border, paddingBottom: Math.max(insets.bottom, 6) }]} accessibilityRole="tablist">
      {tabs.map((item) => {
        const isActive = item.key === active;
        return (
          <Pressable key={item.key} onPress={() => go(item)} accessibilityRole="tab" accessibilityLabel={item.label} accessibilityState={{ selected: isActive }} style={styles.bottomItem}>
            <Ionicons name={isActive ? item.iconActive : item.icon} size={22} color={isActive ? colors.primary : colors.textSubtle} />
            <Text variant="caption" color={isActive ? colors.primary : colors.textSubtle} numberOfLines={1}>{item.short}</Text>
            {badges[item.key] ? <NavBadge count={badges[item.key]!} floating /> : null}
          </Pressable>
        );
      })}
      <Pressable onPress={() => setMore(true)} accessibilityRole="tab" accessibilityLabel="More" accessibilityState={{ selected: moreActive }} style={styles.bottomItem}>
        <Ionicons name={moreActive ? 'ellipsis-horizontal-circle' : 'ellipsis-horizontal-circle-outline'} size={22} color={moreActive ? colors.primary : colors.textSubtle} />
        <Text variant="caption" color={moreActive ? colors.primary : colors.textSubtle} numberOfLines={1}>More</Text>
        {restBadge ? <NavBadge count={restBadge} floating /> : null}
      </Pressable>
      <Sheet visible={more} onClose={() => setMore(false)} title="More">
        {rest.map((item) => (
          <ListRow key={item.key} title={item.label} icon={item.key === active ? item.iconActive : item.icon}
            right={badges[item.key] ? <NavBadge count={badges[item.key]!} /> : undefined}
            onPress={() => { setMore(false); go(item); }} />
        ))}
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  side: { height: '100%' },
  sideHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20 },
  sideItem: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44, paddingHorizontal: 12, borderRadius: 10 },
  account: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: 12, marginTop: 6, borderTopWidth: 1 },
  avatar: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  logout: { width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingBottom: 8 },
  bottom: { flexDirection: 'row', borderTopWidth: 1, paddingTop: 6 },
  bottomItem: { flex: 1, alignItems: 'center', gap: 3, minHeight: 50, justifyContent: 'center' },
});
