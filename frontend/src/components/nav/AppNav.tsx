/**
 * App shell navigation (docs/20_High_Volume_UX.md §3):
 *  - Desktop (≥1100dp): full sidebar that collapses to an icon rail; the choice is remembered on this device.
 *  - Tablet: icon rail.
 *  - Phone: bottom bar with four items + "More".
 * Badges: new online orders, pending kitchen tickets, Tallyko's answers to the owner's requests.
 * Desktop web: "g" then a letter jumps to a section, "?" lists every shortcut, "[" collapses the sidebar.
 * The subscription state ("Development access", "Free demo · 5 days left") sits quietly in the account area.
 */
import React, { useCallback, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import { useAuth } from '@/store/auth';
import { useAccessInfo } from '@/store/access';
import { useData } from '@/store/data';
import { useNet } from '@/lib/sync';
import { useOutbox } from '@/store/outbox';
import { useBadges } from '@/store/badges';
import { signOut } from '@/lib/signOut';
import { LogoMark } from '../Logo';
import { ShortcutHint, StatusPill, Text, useShowShortcuts } from '../ui';
import { itemForGoKey, splitBottomBar, visibleNavItems, type NavItem } from './navItems';
import { useNavPrefs } from './navPrefs';
import { ShortcutsSheet, goKeyItems, useGoShortcuts } from './shortcuts';
import { useAccessLine, useOwnerAnswers, useOwnerAnswersPoll } from './shellStatus';

const GROUP_LABEL = { sell: 'Sell', manage: 'Manage', business: 'Business' } as const;
const RAIL_W = 76;
const FULL_W = 244;
/** The sidebar is dark in both themes; a faint white wash is its hover (no theme token for it yet). */
const SIDEBAR_HOVER = 'rgba(255,255,255,0.06)';
const SIDEBAR_LINE = 'rgba(255,255,255,0.08)';

import { initials } from '@/lib/initials';
export { initials };

export function useNavItems() {
  const role = useAuth((s) => s.session?.role ?? null);
  const businessType = useData((s) => s.settings?.business_type);
  const access = useAccessInfo();
  return visibleNavItems(role, businessType, access);
}

export function useNavBadges(): Record<string, number> {
  const online = useBadges((s) => s.online);
  const kitchen = useBadges((s) => s.kitchen);
  const answers = useOwnerAnswers((s) => s.count);
  return { online, kitchen, watch: answers };
}

function go(item: { href: string }) {
  router.navigate(item.href as never);
}

/** Custom tab bar for expo-router Tabs: sidebar / rail on tablet and desktop, bottom bar on phones. */
export function AppNav({ state }: { state: { index: number; routes: { name: string }[] } }) {
  const { isWide, isDesktop } = useLayout();
  const active = state.routes[state.index]?.name ?? '';
  const items = useNavItems();
  const collapsed = useNavPrefs((s) => s.sidebarCollapsed);
  const [help, setHelp] = useState(false);
  const showKeys = useShowShortcuts();
  useOwnerAnswersPoll(active);

  const onGo = useCallback((key: string) => {
    const item = itemForGoKey(items, key);
    if (!item) return false;
    go(item);
    return true;
  }, [items]);
  useGoShortcuts({
    enabled: isWide && showKeys,
    onGo,
    onHelp: () => setHelp((v) => !v),
    onToggleSidebar: isDesktop ? () => useNavPrefs.getState().set({ sidebarCollapsed: !useNavPrefs.getState().sidebarCollapsed }) : undefined,
  });

  return (
    <>
      {isWide ? <SideNav active={active} items={items} rail={!isDesktop || collapsed} canCollapse={isDesktop} onHelp={showKeys ? () => setHelp(true) : undefined} />
        : <BottomNav active={active} items={items} />}
      {showKeys ? <ShortcutsSheet visible={help} onClose={() => setHelp(false)} items={goKeyItems(items)} /> : null}
    </>
  );
}

function CountBubble({ count, floating }: { count: number; floating?: boolean }) {
  const { colors } = useTheme();
  if (count <= 0) return null;
  return (
    <View style={[styles.count, floating && styles.countFloating, { backgroundColor: colors.bubble, borderColor: floating ? colors.sidebar : 'transparent' }]}
      accessibilityElementsHidden importantForAccessibility="no">
      <Text variant="caption" color={colors.onBubble} style={styles.countText}>{count > 99 ? '99+' : count}</Text>
    </View>
  );
}

function SideNav({ active, items, rail, canCollapse, onHelp }: {
  active: string; items: NavItem[]; rail: boolean; canCollapse: boolean; onHelp?: () => void;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const session = useAuth((s) => s.session);
  const businessName = useData((s) => s.settings?.business_name) ?? session?.businessName ?? 'Your business';
  const badges = useNavBadges();
  const online = useNet((s) => s.online && s.serverReachable);
  const pending = useOutbox((s) => s.queue.length);
  const accessLine = useAccessLine();
  const showKeys = useShowShortcuts();
  const toggle = () => useNavPrefs.getState().set({ sidebarCollapsed: !rail });
  const who = session?.fullName ?? session?.email ?? 'Signed in';
  const syncText = `${online ? 'Online' : 'Offline'}${pending ? ` · ${pending} to sync` : ''}`;

  return (
    <View style={[styles.side, { backgroundColor: colors.sidebar, width: rail ? RAIL_W : FULL_W, paddingTop: insets.top + 14, paddingBottom: insets.bottom + 10 }]}
      {...(Platform.OS === 'web' ? ({ role: 'navigation' } as object) : {})}>
      <View style={[styles.sideHeader, rail && styles.centerRow]}>
        <LogoMark size={rail ? 32 : 34} />
        {!rail ? (
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text variant="bodyStrong" color={colors.sidebarText} numberOfLines={1}>{businessName}</Text>
            <Text variant="caption" color={colors.sidebarMuted} numberOfLines={1}>{(session?.role ?? '').toUpperCase()}</Text>
          </View>
        ) : null}
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: rail ? 10 : 12, paddingBottom: 12 }} showsVerticalScrollIndicator={false}>
        {(['sell', 'manage', 'business'] as const).map((group, gi) => {
          const groupItems = items.filter((i) => i.group === group);
          if (!groupItems.length) return null;
          return (
            <View key={group} style={{ gap: 2, marginTop: gi === 0 ? 12 : rail ? 10 : 16 }}>
              {rail ? (gi > 0 ? <View style={[styles.railDivider, { backgroundColor: SIDEBAR_LINE }]} /> : null)
                : <Text variant="caption" color={colors.sidebarMuted} style={styles.groupLabel}>{GROUP_LABEL[group].toUpperCase()}</Text>}
              {groupItems.map((item) => {
                const isActive = item.route === active;
                const count = badges[item.route] ?? 0;
                const color = isActive ? colors.sidebarActiveText : colors.sidebarText;
                return (
                  <Pressable key={item.route} onPress={() => go(item)} accessibilityRole="link"
                    accessibilityLabel={count ? `${item.label}, ${count} new` : item.label}
                    accessibilityState={{ selected: isActive }}
                    // Rail: the label shows as a native tooltip on hover (web)
                    {...(Platform.OS === 'web' && rail ? ({ title: item.label } as object) : {})}
                    style={({ hovered }: any) => [
                      styles.sideItem,
                      rail ? styles.railItem : null,
                      { backgroundColor: isActive ? colors.sidebarActive : hovered ? SIDEBAR_HOVER : 'transparent' },
                      Platform.OS === 'web' && ({ cursor: 'pointer' } as any),
                    ]}>
                    {isActive && !rail ? <View style={[styles.activeBar, { backgroundColor: colors.sidebarActiveText }]} /> : null}
                    <View>
                      <Ionicons name={isActive ? item.iconActive : item.icon} size={rail ? 22 : 20} color={color} />
                      {rail ? <CountBubble count={count} floating /> : null}
                    </View>
                    {!rail ? <Text variant="smallStrong" color={color} style={{ flex: 1 }} numberOfLines={1}>{item.label}</Text> : null}
                    {!rail && count > 0 ? <CountBubble count={count} /> : null}
                    {!rail && !count && showKeys && item.goKey ? (
                      <ShortcutHint keys={`G ${item.goKey.toUpperCase()}`} color={colors.sidebarMuted} style={styles.hoverHint} />
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          );
        })}
      </ScrollView>

      {/* Account area: who, sync, subscription state (once, quietly), shortcuts, collapse, sign out */}
      <View style={[styles.account, { borderTopColor: SIDEBAR_LINE }, rail && styles.accountRail]}>
        {!rail && accessLine ? (
          <Pressable onPress={() => router.navigate('/settings/billing' as never)} accessibilityRole="link" accessibilityLabel={accessLine.label}
            style={[styles.accessRow, Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}>
            <StatusPill status={accessLine.status} label={accessLine.label} />
          </Pressable>
        ) : null}
        <View style={[styles.who, rail && styles.whoRail]}>
          <View style={[styles.avatar, { backgroundColor: colors.sidebarActive }]} accessibilityLabel={`${who}, ${syncText}`}
            {...(Platform.OS === 'web' && rail ? ({ title: `${who} · ${syncText}${accessLine ? ` · ${accessLine.label}` : ''}` } as object) : {})}>
            <Text variant="smallStrong" color={colors.sidebarActiveText}>{initials(session?.fullName ?? session?.email ?? '?')}</Text>
            <View style={[styles.presence, { backgroundColor: online ? colors.success : colors.warning, borderColor: colors.sidebar }]} />
          </View>
          {!rail ? (
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text variant="smallStrong" color={colors.sidebarText} numberOfLines={1}>{who}</Text>
              <Text variant="caption" color={colors.sidebarMuted} numberOfLines={1}>{syncText}</Text>
            </View>
          ) : null}
          {rail && accessLine?.status === 'development' ? (
            <View accessibilityLabel="Development access" {...(Platform.OS === 'web' ? ({ title: 'Development access' } as object) : {})}>
              <Ionicons name="construct-outline" size={16} color={colors.sidebarMuted} />
            </View>
          ) : null}
          <ShellButton icon="log-out-outline" label="Sign out" onPress={() => void signOut()} />
        </View>
        <View style={[styles.tools, rail && styles.toolsRail]}>
          {onHelp ? <ShellButton icon="help-circle-outline" label="Keyboard shortcuts (?)" onPress={onHelp} small /> : null}
          {canCollapse ? (
            <ShellButton icon={rail ? 'chevron-forward' : 'chevron-back'} label={rail ? 'Expand sidebar ([)' : 'Collapse sidebar ([)'} onPress={toggle} small />
          ) : null}
        </View>
      </View>
    </View>
  );
}

function ShellButton({ icon, label, onPress, small }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; small?: boolean }) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}
      {...(Platform.OS === 'web' ? ({ title: label } as object) : {})}
      style={({ hovered }: any) => [styles.shellBtn, small && styles.shellBtnSmall, hovered && { backgroundColor: SIDEBAR_HOVER },
        Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}>
      <Ionicons name={icon} size={small ? 18 : 20} color={colors.sidebarMuted} />
    </Pressable>
  );
}

function BottomNav({ active, items }: { active: string; items: NavItem[] }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const badges = useNavBadges();
  const { bar, more } = splitBottomBar(items);
  const moreActive = active === 'more' || more.some((i) => i.route === active);
  const moreBadge = more.reduce((n, i) => n + (badges[i.route] ?? 0), 0);
  const entries = [
    ...bar.map((i) => ({ key: i.route, label: i.short ?? i.label, a11y: i.label, icon: i.icon, iconActive: i.iconActive, href: i.href,
      active: i.route === active, count: badges[i.route] ?? 0 })),
    ...(more.length ? [{ key: 'more', label: 'More', a11y: 'More', icon: 'menu-outline' as const, iconActive: 'menu' as const, href: '/more', active: moreActive, count: moreBadge }] : []),
  ];

  return (
    <View style={[styles.bottom, { backgroundColor: colors.surface, borderTopColor: colors.border, paddingBottom: Math.max(insets.bottom, 4) }]}
      accessibilityRole="tablist">
      {entries.map((e) => (
        <Pressable key={e.key} onPress={() => router.navigate(e.href as never)} accessibilityRole="tab"
          accessibilityLabel={e.count ? `${e.a11y}, ${e.count} new` : e.a11y}
          accessibilityState={{ selected: e.active }} style={styles.bottomItem}>
          <View style={[styles.bottomIcon, e.active && { backgroundColor: colors.primarySoft }]}>
            <Ionicons name={e.active ? e.iconActive : e.icon} size={22} color={e.active ? colors.primary : colors.textMuted} />
            {e.count > 0 ? (
              <View style={[styles.count, styles.countFloating, { backgroundColor: colors.bubble, borderColor: colors.surface }]}>
                <Text variant="caption" color={colors.onBubble} style={styles.countText}>{e.count > 9 ? '9+' : e.count}</Text>
              </View>
            ) : null}
          </View>
          <Text variant="caption" color={e.active ? colors.primary : colors.textMuted} numberOfLines={1}>{e.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  side: { height: '100%' },
  sideHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingBottom: 4 },
  centerRow: { justifyContent: 'center', paddingHorizontal: 0 },
  groupLabel: { paddingHorizontal: 12, marginBottom: 4 },
  railDivider: { height: 1, marginHorizontal: 12, marginBottom: 8 },
  sideItem: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44, paddingHorizontal: 12, borderRadius: 10 },
  railItem: { justifyContent: 'center', paddingHorizontal: 0, minHeight: 48 },
  activeBar: { position: 'absolute', left: 0, top: 10, bottom: 10, width: 3, borderRadius: 2 },
  hoverHint: { opacity: 0.55 },
  account: { borderTopWidth: 1, paddingTop: 10, marginTop: 4, paddingHorizontal: 12, gap: 8 },
  accountRail: { paddingHorizontal: 0, alignItems: 'center' },
  accessRow: { paddingHorizontal: 4 },
  who: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 4 },
  whoRail: { flexDirection: 'column', paddingHorizontal: 0, gap: 6 },
  avatar: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  presence: { position: 'absolute', right: -1, bottom: -1, width: 11, height: 11, borderRadius: 6, borderWidth: 2 },
  tools: { flexDirection: 'row', justifyContent: 'flex-end', gap: 2 },
  toolsRail: { flexDirection: 'column', alignItems: 'center' },
  shellBtn: { width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  shellBtnSmall: { width: 36, height: 36 },
  count: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center' },
  countFloating: { position: 'absolute', top: -7, right: -11, minWidth: 18, height: 18, paddingHorizontal: 4, borderWidth: 2, borderRadius: 9 },
  countText: { fontSize: 11, lineHeight: 13, fontVariant: ['tabular-nums'] },
  bottom: { flexDirection: 'row', borderTopWidth: 1, paddingTop: 4 },
  bottomItem: { flex: 1, alignItems: 'center', gap: 2, minHeight: 52, justifyContent: 'center' },
  bottomIcon: { width: 52, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
});
