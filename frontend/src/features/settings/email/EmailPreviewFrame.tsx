/** Rendered email: the real HTML in a sandboxed iframe on web, the plain-text version in the apps. */
import React from 'react';
import { ActivityIndicator, Platform, View } from 'react-native';
import type { EmailPreview } from '@/api/email';
import { Text } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { monoFont } from '../components';

export function EmailPreviewFrame({ preview, loading, error, height = 600 }: {
  preview: EmailPreview | null; loading: boolean; error: string | null; height?: number;
}) {
  const { colors, radius } = useTheme();
  return (
    <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.surface }}>
      <View style={{ paddingHorizontal: 14, paddingVertical: 10, gap: 2, borderBottomWidth: 1, borderBottomColor: colors.divider, backgroundColor: colors.surfaceAlt }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text variant="caption" tone="subtle" style={{ textTransform: 'uppercase', flex: 1 }}>Preview with sample customer</Text>
          {loading ? <ActivityIndicator size="small" color={colors.primary} /> : null}
        </View>
        <Text variant="bodyStrong" numberOfLines={2}>{preview?.subject ?? ' '}</Text>
      </View>
      {error && !preview ? (
        <View style={{ padding: 20 }}><Text tone="danger">{error}</Text></View>
      ) : !preview ? (
        <View style={{ height: 200, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={colors.primary} /></View>
      ) : Platform.OS === 'web' ? (
        React.createElement('iframe', {
          title: 'Email preview',
          srcDoc: preview.html,
          // No scripts, no same-origin access: the template text is only ever rendered, never run.
          sandbox: '',
          style: { width: '100%', height, border: 0, display: 'block', opacity: loading ? 0.6 : 1 },
        })
      ) : (
        <View style={{ padding: 16 }}>
          <Text selectable style={{ fontFamily: monoFont, fontSize: 13, lineHeight: 20 }}>{preview.text}</Text>
        </View>
      )}
      {error && preview ? <View style={{ padding: 10, backgroundColor: colors.dangerSoft }}><Text variant="small" tone="danger">{error}</Text></View> : null}
    </View>
  );
}
