/** Hand-drawn charts for the reports screen (react-native-svg; theme colours; light + dark). */
import React, { useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Line, Path, Text as SvgText } from 'react-native-svg';
import { useTheme } from '@/theme/ThemeProvider';
import { fonts } from '@/theme/tokens';
import { Text } from '@/components/ui';
import { money } from '@/lib/format';
import { hourLabel } from './range';

/** ₹950, ₹1.2k, ₹15k, ₹1.5L — Indian short form for axis labels. */
export function shortMoney(v: number, symbol = '₹'): string {
  const abs = Math.abs(v);
  const trim = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, ''));
  if (abs >= 1e7) return `${symbol}${trim(v / 1e7)}Cr`;
  if (abs >= 1e5) return `${symbol}${trim(v / 1e5)}L`;
  if (abs >= 1e3) return `${symbol}${trim(v / 1e3)}k`;
  return `${symbol}${Math.round(v)}`;
}

/** A "nice" tick step (1, 2, 2.5, 5 × 10^n) giving about four gridlines up to `top`. */
function niceScale(top: number): { max: number; step: number } {
  if (top <= 0) return { max: 1000, step: 250 };
  const raw = top / 4;
  const exp = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = ([1, 2, 2.5, 5, 10].find((m) => raw <= m * exp) ?? 10) * exp;
  return { max: Math.ceil(top / step) * step, step };
}

/** Bar with only the top corners rounded. */
function barPath(x: number, y: number, w: number, h: number, r: number): string {
  if (h <= 0) return '';
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

export function HourlyChart({ hourly, symbol, height = 220 }: { hourly: number[]; symbol: string; height?: number }) {
  const { colors, radius } = useTheme();
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);

  const { start, values, max, step, peak } = useMemo(() => {
    const nonZero = hourly.map((v, h) => (v > 0 ? h : -1)).filter((h) => h >= 0);
    const first = nonZero.length ? nonZero[0] : 8;
    const last = nonZero.length ? nonZero[nonZero.length - 1] : 22;
    const s = Math.min(first, 8);
    const e = Math.max(last, 22);
    const vals = hourly.slice(s, e + 1);
    const top = Math.max(0, ...vals);
    const peakHour = top > 0 ? hourly.indexOf(top) : null;
    return { start: s, values: vals, ...niceScale(top), peak: peakHour };
  }, [hourly]);

  const axisW = 48;
  const axisH = 24;
  const topPad = 10;
  const plotW = Math.max(0, width - axisW - 4);
  const plotH = height - axisH - topPad;
  const n = values.length;
  const slot = n ? plotW / n : 0;
  const barW = Math.max(3, slot * 0.64);
  const labelStep = [1, 2, 3, 4, 6].find((step) => (slot * step) >= 34) ?? 6;
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step);

  const onLayout = (e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width));
  const activeValue = active !== null ? values[active] : null;
  const activeHour = active !== null ? start + active : null;

  return (
    <View>
      <View style={styles.chartHead}>
        {activeHour !== null && activeValue !== null ? (
          <Text variant="smallStrong" accessibilityLiveRegion="polite">
            {hourLabel(activeHour)} – {hourLabel((activeHour + 1) % 24)} · <Text variant="smallStrong" tone="primary">{money(activeValue, symbol, true)}</Text>
          </Text>
        ) : peak !== null ? (
          <Text variant="small" tone="muted">
            Busiest hour: <Text variant="smallStrong">{hourLabel(peak)} – {hourLabel((peak + 1) % 24)}</Text> · {money(hourly[peak], symbol, true)}
          </Text>
        ) : (
          <Text variant="small" tone="muted">No sales in this period</Text>
        )}
        <Text variant="caption" tone="subtle">{Platform.OS === 'web' ? 'Hover or tap a bar for details' : 'Tap a bar for details'}</Text>
      </View>
      <View onLayout={onLayout} style={{ height, width: '100%' }}
        accessible accessibilityLabel={`Sales by hour chart. ${peak !== null ? `Busiest hour ${hourLabel(peak)} with ${money(hourly[peak], symbol, true)}.` : 'No sales.'}`}>
        {width > 0 ? (
          <>
            <Svg width={width} height={height}>
              {ticks.map((t, i) => {
                const y = topPad + plotH - (t / max) * plotH;
                return (
                  <React.Fragment key={i}>
                    <Line x1={axisW} x2={width} y1={y} y2={y} stroke={i === 0 ? colors.borderStrong : colors.divider} strokeWidth={1}
                      strokeDasharray={i === 0 ? undefined : '3,4'} />
                    <SvgText x={axisW - 8} y={y + 4} fontSize={11} fontFamily={fonts.medium} fill={colors.textSubtle} textAnchor="end">
                      {shortMoney(t, symbol)}
                    </SvgText>
                  </React.Fragment>
                );
              })}
              {values.map((v, i) => {
                const h = (v / max) * plotH;
                const x = axisW + i * slot + (slot - barW) / 2;
                const y = topPad + plotH - h;
                const dim = active !== null && active !== i;
                return (
                  <Path key={i} d={barPath(x, y, barW, Math.max(h, v > 0 ? 2 : 0), 4)}
                    fill={active === i ? colors.primaryHover : colors.primary} opacity={dim ? 0.35 : 1} />
                );
              })}
              {values.map((_, i) => {
                const hour = start + i;
                if ((hour - start) % labelStep !== 0) return null;
                return (
                  <SvgText key={`l${i}`} x={axisW + i * slot + slot / 2} y={height - 6} fontSize={11} fontFamily={fonts.medium}
                    fill={active === i ? colors.text : colors.textSubtle} textAnchor="middle">
                    {hourLabel(hour, true)}
                  </SvgText>
                );
              })}
            </Svg>
            {/* Hit areas: full-height columns are easier to hover/tap than thin bars */}
            <View style={[StyleSheet.absoluteFill, { left: axisW, top: 0, bottom: axisH, flexDirection: 'row' }]}>
              {values.map((v, i) => (
                <Pressable key={i} style={[{ width: slot, height: '100%' }, Platform.OS === 'web' && ({ cursor: 'default' } as any)]}
                  onHoverIn={() => setActive(i)} onHoverOut={() => setActive((a) => (a === i ? null : a))}
                  onPress={() => setActive((a) => (a === i ? null : i))}
                  accessibilityLabel={`${hourLabel(start + i)}: ${money(v, symbol, true)}`} />
              ))}
            </View>
            {active !== null && activeValue !== null ? (
              <View pointerEvents="none" style={[styles.tooltip, {
                backgroundColor: colors.text, borderRadius: radius.sm,
                left: Math.min(Math.max(0, axisW + active * slot + slot / 2 - 50), width - 100),
                top: Math.max(0, topPad + plotH - (activeValue / max) * plotH - 34),
              }]}>
                <Text variant="caption" color={colors.surface} align="center">{money(activeValue, symbol, true)}</Text>
              </View>
            ) : null}
          </>
        ) : null}
      </View>
    </View>
  );
}

export interface BarDatum { key: string; label: string; value: number; detail?: string }

/** Horizontal bars with share-of-total, for categorical breakdowns (payments, order types, categories). */
export function BarList({ data, symbol, emptyLabel = 'Nothing to show' }: { data: BarDatum[]; symbol: string; emptyLabel?: string }) {
  const { colors } = useTheme();
  const total = data.reduce((n, d) => n + Math.max(0, d.value), 0);
  const max = Math.max(0, ...data.map((d) => d.value));
  if (!data.length || total <= 0) return <Text tone="subtle" variant="small" style={{ paddingVertical: 12 }}>{emptyLabel}</Text>;
  return (
    <View style={{ gap: 14 }}>
      {data.map((d) => {
        const pct = total > 0 ? (d.value / total) * 100 : 0;
        return (
          <View key={d.key} style={{ gap: 6 }} accessible accessibilityLabel={`${d.label}: ${money(d.value, symbol)}, ${pct.toFixed(0)} percent${d.detail ? `, ${d.detail}` : ''}`}>
            <View style={styles.barHead}>
              <Text variant="smallStrong" style={{ flex: 1 }} numberOfLines={1}>{d.label}</Text>
              <Text variant="smallStrong" style={{ fontVariant: ['tabular-nums'] }}>{money(d.value, symbol, true)}</Text>
            </View>
            <View style={[styles.track, { backgroundColor: colors.surfaceSunken }]}>
              <View style={[styles.fill, { width: `${max > 0 ? Math.max(1.5, (d.value / max) * 100) : 0}%`, backgroundColor: colors.primary }]} />
            </View>
            <Text variant="caption" tone="subtle">{pct.toFixed(pct < 10 && pct > 0 ? 1 : 0)}%{d.detail ? ` · ${d.detail}` : ''}</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  chartHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8, minHeight: 20, flexWrap: 'wrap' },
  tooltip: { position: 'absolute', width: 100, paddingVertical: 4 },
  barHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4 },
});
