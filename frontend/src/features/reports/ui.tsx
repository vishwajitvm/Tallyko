import React, { useEffect, useRef, useState } from 'react';
import { Animated, Platform, ScrollView, StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme/ThemeProvider';
import { Button, Card, Text } from '@/components/ui';

type IconName = keyof typeof Ionicons.glyphMap;

/** Card with a title row (title, optional subtitle and actions). */
export function Panel({ title, subtitle, icon, actions, children, style }: {
  title: string; subtitle?: string; icon?: IconName; actions?: React.ReactNode; children: React.ReactNode; style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  return (
    <Card style={[{ gap: 16 }, style]}>
      <View style={styles.panelHead}>
        {icon ? (
          <View style={[styles.panelIcon, { backgroundColor: colors.surfaceSunken }]}>
            <Ionicons name={icon} size={16} color={colors.textMuted} />
          </View>
        ) : null}
        <View style={{ flex: 1, minWidth: 140 }}>
          <Text variant="h3" accessibilityRole="header">{title}</Text>
          {subtitle ? <Text variant="small" tone="muted">{subtitle}</Text> : null}
        </View>
        {actions ? <View style={styles.panelActions}>{actions}</View> : null}
      </View>
      {children}
    </Card>
  );
}

export function PanelError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { colors, radius } = useTheme();
  return (
    <View style={[styles.panelError, { backgroundColor: colors.dangerSoft, borderRadius: radius.md }]}>
      <Ionicons name="alert-circle-outline" size={18} color={colors.dangerText} />
      <Text variant="small" color={colors.dangerText} style={{ flex: 1 }}>{message}</Text>
      <Button title="Retry" size="sm" variant="secondary" icon="refresh" onPress={onRetry} />
    </View>
  );
}

export type KpiTone = 'primary' | 'success' | 'info' | 'warning' | 'danger' | 'accent' | 'neutral';

export interface Kpi { key: string; label: string; value: string; hint?: string; icon: IconName; tone: KpiTone }

/** Responsive KPI grid: 2 columns on phones / narrow panes, 4 on wide ones (8 KPIs → even 4×2 or 2×4 grid). */
export function KpiGrid({ items }: { items: Kpi[] }) {
  const [width, setWidth] = useState(0);
  const gap = 12;
  const cols = width >= 820 ? 4 : 2;
  // -1px: browsers round sub-pixel widths up, which would otherwise wrap the last card
  const cardW = width ? Math.floor((width - gap * (cols - 1)) / cols) - 1 : 0;
  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={[styles.kpiGrid, { gap }]}>
      {width ? items.map((k) => <KpiCard key={k.key} kpi={k} width={cardW} />) : null}
    </View>
  );
}

function KpiCard({ kpi, width }: { kpi: Kpi; width: number }) {
  const { colors, radius } = useTheme();
  const tones: Record<KpiTone, [string, string]> = {
    primary: [colors.primarySoft, colors.primary],
    success: [colors.successSoft, colors.success],
    info: [colors.infoSoft, colors.info],
    warning: [colors.warningSoft, colors.warning],
    danger: [colors.dangerSoft, colors.danger],
    accent: [colors.accentSoft, colors.accentText],
    neutral: [colors.surfaceSunken, colors.textMuted],
  };
  const [bg, fg] = tones[kpi.tone];
  return (
    <View accessible accessibilityLabel={`${kpi.label}: ${kpi.value}${kpi.hint ? `. ${kpi.hint}` : ''}`}
      style={[styles.kpi, { width, backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={[styles.kpiIcon, { backgroundColor: bg }]}>
          <Ionicons name={kpi.icon} size={15} color={fg} />
        </View>
        <Text variant="small" tone="muted" numberOfLines={1} style={{ flex: 1 }}>{kpi.label}</Text>
      </View>
      <Text variant="h1" numberOfLines={1} adjustsFontSizeToFit style={{ fontVariant: ['tabular-nums'] }}>{kpi.value}</Text>
      <Text variant="caption" tone="subtle" numberOfLines={1}>{kpi.hint ?? ' '}</Text>
    </View>
  );
}

export interface Column<T> {
  key: string;
  label: string;
  align?: 'left' | 'right';
  flex?: number;
  minWidth?: number;
  render: (row: T, index: number) => React.ReactNode;
}

/** Simple table; scrolls sideways on narrow screens instead of squashing columns. */
export function DataTable<T>({ columns, rows, rowKey, footer, minWidth = 0 }: {
  columns: Column<T>[]; rows: T[]; rowKey: (row: T, i: number) => string; footer?: React.ReactNode[]; minWidth?: number;
}) {
  const { colors } = useTheme();
  const [width, setWidth] = useState(0);
  const tableWidth = Math.max(width, minWidth);
  const cell = (c: Column<T>) => ({
    flex: c.flex ?? 1, minWidth: c.minWidth ?? 64, alignItems: c.align === 'right' ? ('flex-end' as const) : ('flex-start' as const),
  });
  const table = (
    <View style={{ width: tableWidth || '100%' }} accessibilityRole={Platform.OS === 'web' ? ('table' as any) : undefined}>
      <View style={[styles.tr, styles.th, { borderBottomColor: colors.border }]}>
        {columns.map((c) => (
          <View key={c.key} style={cell(c)}>
            <Text variant="caption" tone="subtle" style={{ textTransform: 'uppercase' }} numberOfLines={1}>{c.label}</Text>
          </View>
        ))}
      </View>
      {rows.map((row, i) => (
        <View key={rowKey(row, i)} style={[styles.tr, { borderBottomColor: colors.divider }]}>
          {columns.map((c) => (
            <View key={c.key} style={cell(c)}>{c.render(row, i)}</View>
          ))}
        </View>
      ))}
      {footer ? (
        <View style={[styles.tr, { borderBottomWidth: 0, borderTopWidth: 1, borderTopColor: colors.border }]}>
          {columns.map((c, i) => (
            <View key={c.key} style={cell(c)}>{footer[i] ?? null}</View>
          ))}
        </View>
      ) : null}
    </View>
  );
  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {minWidth > width && width > 0 ? <ScrollView horizontal showsHorizontalScrollIndicator>{table}</ScrollView> : table}
    </View>
  );
}

export function Cell({ children, strong, muted, align }: { children: React.ReactNode; strong?: boolean; muted?: boolean; align?: 'right' }) {
  return (
    <Text variant={strong ? 'smallStrong' : 'small'} tone={muted ? 'muted' : 'default'} numberOfLines={2}
      style={[{ fontVariant: ['tabular-nums'] }, align === 'right' && { textAlign: 'right' }]}>
      {children}
    </Text>
  );
}

/** Pulsing placeholder block. */
export function Skeleton({ width = '100%', height = 16, radius: r, style }: { width?: DimensionValue; height?: number; radius?: number; style?: StyleProp<ViewStyle> }) {
  const { colors, radius } = useTheme();
  const opacity = useRef(new Animated.Value(0.55)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(opacity, { toValue: 0.55, duration: 700, useNativeDriver: Platform.OS !== 'web' }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return <Animated.View style={[{ width, height, borderRadius: r ?? radius.sm, backgroundColor: colors.surfaceSunken, opacity }, style]} />;
}

const styles = StyleSheet.create({
  panelHead: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  panelIcon: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  panelActions: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  panelError: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  kpi: { borderWidth: 1, padding: 16, gap: 8 },
  kpiIcon: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  tr: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1 },
  th: { paddingTop: 0, paddingBottom: 8 },
});
