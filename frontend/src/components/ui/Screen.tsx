import React from 'react';
import { RefreshControl, ScrollView, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import { Text } from './Text';
import { OfflineBanner } from '../OfflineBanner';

/**
 * Standard page frame: title row with actions, optional toolbar, scrollable or fixed body.
 * Content is width-capped on big screens so forms don't stretch across a desktop monitor.
 */
export function Screen({ title, subtitle, actions, toolbar, children, scroll = true, refreshing, onRefresh, maxWidth = 1280, contentStyle, padded = true }: {
  title?: string; subtitle?: string; actions?: React.ReactNode; toolbar?: React.ReactNode; children: React.ReactNode;
  scroll?: boolean; refreshing?: boolean; onRefresh?: () => void; maxWidth?: number; contentStyle?: StyleProp<ViewStyle>; padded?: boolean;
}) {
  const { colors } = useTheme();
  const { isPhone } = useLayout();
  const insets = useSafeAreaInsets();
  const pad = isPhone ? 16 : 24;

  const header = title ? (
    <View style={[styles.header, { paddingHorizontal: pad, paddingTop: (isPhone ? insets.top : 0) + (isPhone ? 12 : 20) }]}>
      <View style={[styles.headerInner, { maxWidth }]}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant={isPhone ? 'h1' : 'display'} numberOfLines={1}>{title}</Text>
          {subtitle ? <Text tone="muted" numberOfLines={2}>{subtitle}</Text> : null}
        </View>
        {actions ? <View style={styles.actions}>{actions}</View> : null}
      </View>
      {toolbar ? <View style={[styles.toolbar, { maxWidth }]}>{toolbar}</View> : null}
    </View>
  ) : null;

  const body = (
    <View style={[{ width: '100%', maxWidth, alignSelf: 'center', gap: 16 }, padded && { paddingHorizontal: pad, paddingBottom: 32 }, contentStyle]}>
      {children}
    </View>
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <OfflineBanner />
      {header}
      {scroll ? (
        <ScrollView
          contentContainerStyle={{ paddingTop: 12, flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
          refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.primary} /> : undefined}
        >
          {body}
        </ScrollView>
      ) : (
        <View style={{ flex: 1, paddingTop: 12 }}>{body}</View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { gap: 12, alignItems: 'center' },
  headerInner: { flexDirection: 'row', alignItems: 'center', gap: 12, width: '100%', flexWrap: 'wrap' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  toolbar: { width: '100%' },
});
