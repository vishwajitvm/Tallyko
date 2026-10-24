/**
 * Page frame for every settings page.
 *  - Tablet and desktop: a section list with "Search settings" on the left, the page on the right (Shopify/Stripe style).
 *    Typing "gst", "upi", "printer", "swiggy"… lists the matching settings; Enter opens the first one. Ctrl+K focuses it.
 *  - Phone: single column with a back button to the settings list (which has the same search).
 * A `footer` (the sticky save bar) stays pinned under the scrolling content. `scroll={false}` gives the page a fixed
 * body for virtualised lists (Staff), which then scroll by themselves.
 */
import React, { useMemo, useRef, useState } from 'react';
import { Platform, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { router, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { IconButton, Input, ShortcutHint, Text, confirm, useHotkeys } from '@/components/ui';
import { OfflineBanner } from '@/components/OfflineBanner';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import { useAuth } from '@/store/auth';
import { useAccessInfo } from '@/store/access';
import { sectionsFor, type SettingsKey, type SettingsSection } from './sections';
import { matchSections, searchSettings, type SettingsTopic } from './search';

export async function confirmDiscard(dirty: boolean): Promise<boolean> {
  if (!dirty) return true;
  return confirm({ title: 'Discard unsaved changes?', message: 'You changed some settings but did not save them.', confirmLabel: 'Discard', danger: true });
}

export function goBackToSettings() {
  if (router.canGoBack()) router.back();
  else router.replace('/settings' as Href);
}

export function useSettingsSections(): SettingsSection[] {
  const role = useAuth((s) => s.session?.role ?? null);
  const access = useAccessInfo();
  return useMemo(() => sectionsFor(role, access), [role, access]);
}

/** Search box + results, shared by the left section list and the phone settings home. */
export function SettingsSearch({ query, onQuery, sections, onOpen, compact, inputRef }: {
  query: string; onQuery: (q: string) => void; sections: SettingsSection[]; onOpen: (href: string) => void; compact?: boolean;
  inputRef?: React.RefObject<TextInput | null>;
}) {
  const { colors } = useTheme();
  const results = useMemo(() => searchSettings(query, sections), [query, sections]);
  return (
    <View style={{ gap: 6 }}>
      <Input
        ref={inputRef}
        value={query}
        onChangeText={onQuery}
        placeholder="Search settings"
        accessibilityLabel="Search settings"
        icon="search"
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="go"
        onSubmitEditing={() => { if (results[0]) onOpen(results[0].href); }}
        onKeyPress={(e: any) => { if (Platform.OS === 'web' && e.nativeEvent?.key === 'Escape' && query) { e.preventDefault?.(); onQuery(''); } }}
        right={query ? (
          <Pressable onPress={() => onQuery('')} accessibilityRole="button" accessibilityLabel="Clear search" hitSlop={8} style={{ paddingRight: 10 }}>
            <Ionicons name="close-circle" size={18} color={colors.textSubtle} />
          </Pressable>
        ) : !compact ? <View style={{ paddingRight: 10 }}><ShortcutHint keys="Ctrl+K" /></View> : undefined}
      />
      {query.trim() ? <TopicList topics={results} onOpen={onOpen} query={query} /> : null}
    </View>
  );
}

function TopicList({ topics, onOpen, query }: { topics: SettingsTopic[]; onOpen: (href: string) => void; query: string }) {
  const { colors, radius } = useTheme();
  if (!topics.length) {
    return <Text variant="small" tone="muted" style={{ paddingHorizontal: 8, paddingVertical: 6 }}>{`Nothing matches “${query.trim()}”. Try gst, upi, printer or staff.`}</Text>;
  }
  return (
    <View accessibilityRole="list" style={{ gap: 2 }}>
      {topics.map((t, i) => (
        <Pressable key={`${t.href}-${t.title}`} onPress={() => onOpen(t.href)} accessibilityRole="link" accessibilityLabel={`${t.title}, in ${t.hint}`}
          style={({ hovered }: any) => [styles.topic, { borderRadius: radius.md, backgroundColor: hovered || i === 0 ? colors.surfaceSunken : 'transparent' },
            Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}>
          <Ionicons name={t.icon ?? 'settings-outline'} size={16} color={colors.textMuted} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text variant="smallStrong" numberOfLines={1}>{t.title}</Text>
            {t.hint ? <Text variant="caption" tone="subtle" numberOfLines={1}>{t.hint}</Text> : null}
          </View>
          {i === 0 ? <ShortcutHint keys="Enter" /> : null}
        </Pressable>
      ))}
    </View>
  );
}

export function SettingsFrame({ active, title, subtitle, actions, children, footer, dirty = false, scrollRef, refreshing, onRefresh, maxWidth = 960, onBodyOffset, scroll = true }: {
  active: SettingsKey; title: string; subtitle?: string; actions?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode;
  dirty?: boolean; scrollRef?: React.RefObject<ScrollView | null>; refreshing?: boolean; onRefresh?: () => void; maxWidth?: number;
  /** Reports where the page body starts inside the scroll view (for "jump to section"). */
  onBodyOffset?: (y: number) => void;
  /** false: the body does not scroll; a virtualised list inside fills the height and scrolls itself. */
  scroll?: boolean;
}) {
  const { colors } = useTheme();
  const { isWide, isDesktop, isPhone } = useLayout();
  const insets = useSafeAreaInsets();
  const pad = isPhone ? 16 : 24;
  const showBack = !isWide && active !== 'overview';

  const back = async () => {
    if (await confirmDiscard(dirty)) goBackToSettings();
  };

  const header = (
    <View style={[styles.header, { paddingHorizontal: pad, paddingTop: (isPhone ? insets.top : 0) + (isPhone ? 10 : 20) }]}>
      <View style={[styles.headerInner, { maxWidth }]}>
        {showBack ? <IconButton icon="arrow-back" accessibilityLabel="Back to settings" onPress={back} style={{ marginLeft: -8 }} /> : null}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant={isPhone ? 'h1' : 'display'} numberOfLines={1} accessibilityRole="header">{title}</Text>
          {subtitle ? <Text tone="muted" numberOfLines={isPhone ? 2 : 3}>{subtitle}</Text> : null}
        </View>
        {actions ? <View style={styles.actions}>{actions}</View> : null}
      </View>
    </View>
  );

  const content = (
    <View onLayout={onBodyOffset ? (e) => onBodyOffset(e.nativeEvent.layout.y) : undefined}
      style={[{ width: '100%', maxWidth: maxWidth + pad * 2, alignSelf: isWide ? 'flex-start' : 'center', paddingHorizontal: pad, paddingTop: 16, gap: 24 },
        !scroll && { flex: 1, minHeight: 0, paddingBottom: 12 }]}>
      {children}
    </View>
  );

  const body = scroll ? (
    <ScrollView
      ref={scrollRef}
      contentContainerStyle={{ paddingBottom: 40, flexGrow: 1 }}
      keyboardShouldPersistTaps="handled"
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.primary} /> : undefined}
    >
      {header}
      {content}
    </ScrollView>
  ) : (
    <View style={{ flex: 1, minHeight: 0 }}>
      {header}
      {content}
    </View>
  );

  if (!isWide) {
    return (
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <OfflineBanner />
        <View style={{ flex: 1, minHeight: 0 }}>{body}</View>
        {footer}
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <OfflineBanner />
      <View style={{ flex: 1, flexDirection: 'row', minHeight: 0 }}>
        <SectionNav active={active} dirty={dirty} width={isDesktop ? 252 : 220} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flex: 1, minHeight: 0 }}>{body}</View>
          {footer}
        </View>
      </View>
    </View>
  );
}

function SectionNav({ active, dirty, width }: { active: SettingsKey; dirty: boolean; width: number }) {
  const { colors, radius } = useTheme();
  const sections = useSettingsSections();
  const [query, setQuery] = useState('');
  const inputRef = useRef<TextInput>(null);
  useHotkeys({ 'Ctrl+K': () => inputRef.current?.focus() }, []);
  const shown = useMemo(() => matchSections(query, sections), [query, sections]);

  const open = async (href: string) => {
    if (!(await confirmDiscard(dirty))) return;
    setQuery('');
    router.replace(href as Href);
  };

  return (
    <View style={[styles.nav, { width, borderRightColor: colors.border, backgroundColor: colors.surfaceAlt }]}>
      <View style={{ paddingHorizontal: 12, paddingTop: 20, paddingBottom: 10, gap: 10 }}>
        <Text variant="caption" tone="subtle" style={{ textTransform: 'uppercase', paddingHorizontal: 4 }}>Settings</Text>
        <SettingsSearch query={query} onQuery={setQuery} sections={sections} onOpen={(href) => void open(href)} inputRef={inputRef} />
      </View>
      {query.trim() ? null : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 16, gap: 2 }} accessibilityRole="menu">
          {shown.map((s) => {
            const selected = s.key === active;
            return (
              <Pressable
                key={s.key}
                accessibilityRole="menuitem"
                accessibilityState={{ selected }}
                accessibilityLabel={s.label}
                onPress={() => { if (!selected) void open(s.href); }}
                {...(Platform.OS === 'web' ? ({ title: s.description } as object) : {})}
                style={({ hovered }: any) => [
                  styles.navItem,
                  { borderRadius: radius.md, backgroundColor: selected ? colors.primarySoft : hovered ? colors.surfaceSunken : 'transparent' },
                  Platform.OS === 'web' && ({ cursor: 'pointer' } as any),
                ]}
              >
                <Ionicons name={s.icon} size={18} color={selected ? colors.primarySoftText : colors.textMuted} />
                <Text variant="smallStrong" color={selected ? colors.primarySoftText : colors.text} numberOfLines={1} style={{ flex: 1 }}>{s.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { gap: 12 },
  headerInner: { flexDirection: 'row', alignItems: 'center', gap: 12, width: '100%', flexWrap: 'wrap' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  nav: { borderRightWidth: 1 },
  navItem: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, paddingHorizontal: 12 },
  topic: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingHorizontal: 10 },
});
