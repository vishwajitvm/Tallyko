/**
 * Compact app-shell notice for owners and managers when the Tallyko subscription needs attention:
 *   "Free demo · 3 days left · Renew", "Subscription ending · 5 days left", "Payment due · access stops on 28 Oct 2026".
 * - One 40 px line that never floats over content: at the top of the page on tablets/desktops, above the bottom bar on phones.
 * - Hidden for the rest of the day with ×, per notice; "Payment due" (grace) cannot be hidden.
 * - Development access and healthy subscriptions show nothing here: the quiet status lives in the sidebar account area,
 *   and in More / Settings on phones.
 * Staff never see it (the lock screen covers them when it matters).
 */
import React from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/store/auth';
import { useSubscription } from '@/store/subscription';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import { bannerFor } from '@/features/subscription/format';
import { hideNoticeToday, isNoticeHidden, useNavPrefs } from './nav/navPrefs';
import { Text } from './ui';

export function SubscriptionBanner({ placement = 'top' }: { placement?: 'top' | 'bottom' }) {
  const { colors, radius } = useTheme();
  const { isWide, isPhone } = useLayout();
  const insets = useSafeAreaInsets();
  const role = useAuth((s) => s.session?.role ?? null);
  const current = useSubscription((s) => s.current);
  const hidden = useNavPrefs((s) => s.hiddenNotices);

  if (role !== 'owner' && role !== 'manager') return null;
  // On phones the notice sits above the bottom bar; on wider screens at the top
  if ((placement === 'top') !== isWide) return null;

  const banner = bannerFor(current);
  if (!banner) return null;
  const grace = current?.state === 'grace';
  const key = `${current?.state ?? ''}:${banner.title}:${current?.paid_until ?? ''}`;
  if (!grace && isNoticeHidden(hidden, key)) return null;

  const tone = {
    info: { bg: colors.infoSoft, fg: colors.infoText, icon: 'sparkles-outline' as const },
    warning: { bg: colors.warningSoft, fg: colors.warningText, icon: 'time-outline' as const },
    danger: { bg: colors.dangerSoft, fg: colors.dangerText, icon: 'alert-circle' as const },
  }[banner.tone];
  const isOwner = role === 'owner';
  const renew = () => router.push('/settings/billing' as Href);
  const label = `${banner.title} · ${banner.detail}`;
  const topPad = placement === 'top' ? insets.top : 0;

  return (
    <View style={[styles.bar, { backgroundColor: tone.bg, paddingTop: topPad, borderColor: colors.border },
      placement === 'top' ? { borderBottomWidth: StyleSheet.hairlineWidth } : { borderTopWidth: StyleSheet.hairlineWidth }]}
      accessibilityRole={grace ? 'alert' : 'text'} accessibilityLabel={isOwner ? `${label}. Renew.` : `${label}. Ask the owner to renew.`}>
      <Ionicons name={tone.icon} size={16} color={tone.fg} />
      <Text variant="smallStrong" color={tone.fg} numberOfLines={1} style={styles.text}>
        {banner.title}<Text variant="small" color={tone.fg}>{` · ${banner.detail}`}</Text>
        {!isOwner && !isPhone ? <Text variant="small" color={tone.fg}>{' · ask the owner to renew'}</Text> : null}
      </Text>
      {isOwner ? (
        <Pressable onPress={renew} accessibilityRole="button" accessibilityLabel="Renew subscription" hitSlop={8}
          style={({ hovered, pressed }: any) => [styles.renew, { borderColor: tone.fg, borderRadius: radius.pill, opacity: pressed ? 0.7 : 1 },
            hovered && { backgroundColor: colors.surface }, Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}>
          <Text variant="smallStrong" color={tone.fg}>Renew</Text>
        </Pressable>
      ) : null}
      {!grace ? (
        <Pressable onPress={() => hideNoticeToday(key)} accessibilityRole="button" accessibilityLabel="Hide until tomorrow" hitSlop={6}
          {...(Platform.OS === 'web' ? ({ title: 'Hide until tomorrow' } as object) : {})}
          style={({ hovered }: any) => [styles.close, { borderRadius: radius.md }, hovered && { backgroundColor: colors.surface },
            Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}>
          <Ionicons name="close" size={16} color={tone.fg} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 14, paddingRight: 6, minHeight: 40 },
  text: { flex: 1, minWidth: 0 },
  renew: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, height: 28, borderWidth: 1 },
  close: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
});
