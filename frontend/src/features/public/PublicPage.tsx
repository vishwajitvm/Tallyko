/**
 * Lightweight frame for public (logged-out) pages: privacy policy, account deletion. No staff chrome, no offline
 * banner — just the brand, a readable centred column and a footer with the legal links.
 */
import React from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Link, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import { Text } from '@/components/ui';
import { Logo } from '@/components/Logo';
import { PageTitle } from './PageTitle';

export function PublicPage({ title, children, maxWidth = 760 }: { title: string; children: React.ReactNode; maxWidth?: number }) {
  const { colors } = useTheme();
  const { isPhone } = useLayout();
  const insets = useSafeAreaInsets();
  const pad = isPhone ? 16 : 24;

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <PageTitle title={title} />
      <View style={[styles.topBar, { paddingTop: insets.top + 10, paddingHorizontal: pad, borderBottomColor: colors.border, backgroundColor: colors.surface }]}>
        <View style={[styles.topInner, { maxWidth }]}>
          <Pressable onPress={goBack} accessibilityRole="button" accessibilityLabel="Go back"
            style={({ hovered }: any) => [styles.back, { backgroundColor: hovered ? colors.surfaceSunken : 'transparent' }, Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}>
            <Ionicons name="arrow-back" size={20} color={colors.text} />
          </Pressable>
          <Logo size={26} />
        </View>
      </View>
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingHorizontal: pad, paddingTop: isPhone ? 20 : 36, paddingBottom: insets.bottom + 24 }}
        keyboardShouldPersistTaps="handled">
        <View style={{ width: '100%', maxWidth, alignSelf: 'center', flexGrow: 1 }}>
          {children}
          <PublicFooter />
        </View>
      </ScrollView>
    </View>
  );
}

export function PublicFooter({ businessName }: { businessName?: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.footer, { borderTopColor: colors.border }]}>
      <Text variant="small" tone="subtle" align="center">
        {businessName ? `${businessName} · ` : ''}Powered by Tallyko
      </Text>
      <View style={styles.footerLinks}>
        <Link href="/privacy" accessibilityRole="link"><Text variant="small" tone="muted">Privacy policy</Text></Link>
        <Text variant="small" tone="subtle">·</Text>
        <Link href="/delete-account" accessibilityRole="link"><Text variant="small" tone="muted">Delete account</Text></Link>
      </View>
    </View>
  );
}

/** Rounded notice box used on public pages (info / warning / danger / success). */
export function Notice({ tone = 'info', icon, title, children }: {
  tone?: 'info' | 'warning' | 'danger' | 'success'; icon?: keyof typeof Ionicons.glyphMap; title?: string; children?: React.ReactNode;
}) {
  const { colors, radius } = useTheme();
  const map = {
    info: [colors.infoSoft, colors.infoText, 'information-circle'],
    warning: [colors.warningSoft, colors.warningText, 'alert-circle'],
    danger: [colors.dangerSoft, colors.dangerText, 'warning'],
    success: [colors.successSoft, colors.successText, 'checkmark-circle'],
  } as const;
  const [bg, fg, defaultIcon] = map[tone];
  return (
    <View style={[styles.notice, { backgroundColor: bg, borderRadius: radius.md }]} accessibilityRole={tone === 'danger' ? 'alert' : undefined}>
      <Ionicons name={icon ?? defaultIcon} size={20} color={fg} style={{ marginTop: 1 }} />
      <View style={{ flex: 1, gap: 2 }}>
        {title ? <Text variant="bodyStrong" color={fg}>{title}</Text> : null}
        {typeof children === 'string' ? <Text variant="small" color={fg}>{children}</Text> : children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topBar: { borderBottomWidth: 1, paddingBottom: 10, alignItems: 'center' },
  topInner: { width: '100%', flexDirection: 'row', alignItems: 'center', gap: 8 },
  back: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginLeft: -10 },
  footer: { marginTop: 40, paddingTop: 20, borderTopWidth: 1, gap: 6, alignItems: 'center' },
  footerLinks: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  notice: { flexDirection: 'row', gap: 10, padding: 14 },
});
