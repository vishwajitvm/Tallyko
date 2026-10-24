/**
 * Small pieces shared by the GST & taxes screen and its sheets: permission check, date helpers,
 * a date + time field (native inputs on web, typed fields on phones/tablets) and the rate pill.
 */
import React, { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import { Chip, Input, Text } from '@/components/ui';
import { hasAccess, useAccessInfo } from '@/store/access';
import { can, useAuth } from '@/store/auth';
import { useNet } from '@/lib/sync';
import { fonts } from '@/theme/tokens';
import { useTheme } from '@/theme/ThemeProvider';
import { formatRate } from '@/api/taxes';

/** True when the user may change tax settings (falls back to the built-in role rules until /access/me loads). */
export function useCanManageTaxes(): boolean {
  const info = useAccessInfo();
  const role = useAuth((s) => s.session?.role ?? null);
  return hasAccess(info, { permissions: ['settings.manage'] }) ?? can(role, 'manage');
}

export function useOnline(): boolean {
  return useNet((s) => s.online && s.serverReachable);
}

// ---------------------------------------------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------------------------------------------

export function tomorrowMidnight(from = new Date()): Date {
  return new Date(from.getFullYear(), from.getMonth(), from.getDate() + 1, 0, 0, 0, 0);
}

export function firstOfNextMonth(from = new Date()): Date {
  return new Date(from.getFullYear(), from.getMonth() + 1, 1, 0, 0, 0, 0);
}

const isLocalMidnight = (d: Date) => d.getHours() === 0 && d.getMinutes() === 0;

/** "1 Nov 2026" (or "1 Nov 2026, 2:30 pm" when it doesn't start at midnight). */
export function formatEffective(value: string | Date, withTime: boolean | 'auto' = 'auto'): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '';
  const date = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  const showTime = withTime === 'auto' ? !isLocalMidnight(d) : withTime;
  return showTime ? `${date}, ${d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}` : date;
}

const pad = (n: number) => String(n).padStart(2, '0');
const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const isoTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const dmy = (d: Date) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;

function parseDmy(text: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text.trim());
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = Number(m[3]);
  const probe = new Date(y, mo - 1, d);
  if (probe.getFullYear() !== y || probe.getMonth() !== mo - 1 || probe.getDate() !== d) return null;
  return { y, m: mo, d };
}

function parseTime(text: string): { h: number; min: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? { h, min } : null;
}

/**
 * Date + time picker with quick choices. Reports `null` while the typed value is incomplete or invalid.
 * Web uses the browser's own date/time inputs; the apps use typed DD/MM/YYYY and HH:MM fields.
 */
export function DateTimeField({ value, onChange, error, disabled }: {
  value: Date | null; onChange: (d: Date | null) => void; error?: string | null; disabled?: boolean;
}) {
  const { colors, radius, dark } = useTheme();
  const [dateText, setDateText] = useState(value ? dmy(value) : '');
  const [timeText, setTimeText] = useState(value ? isoTime(value) : '00:00');

  // Keep the typed fields in step when a quick choice is picked.
  useEffect(() => {
    if (!value) return;
    setDateText(dmy(value));
    setTimeText(isoTime(value));
  }, [value?.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps

  const tomorrow = tomorrowMidnight();
  const nextMonth = firstOfNextMonth();
  const quick = [
    { label: 'Tomorrow', date: tomorrow },
    ...(nextMonth.getTime() !== tomorrow.getTime() ? [{ label: `1 ${nextMonth.toLocaleDateString('en-IN', { month: 'short' })}`, date: nextMonth }] : []),
  ];

  const emit = (dText: string, tText: string) => {
    const d = parseDmy(dText);
    const t = parseTime(tText);
    onChange(d && t ? new Date(d.y, d.m - 1, d.d, t.h, t.min, 0, 0) : null);
  };

  const webInputStyle = {
    height: 46, boxSizing: 'border-box' as const, borderWidth: 1, borderStyle: 'solid', borderColor: error ? colors.danger : colors.border,
    borderRadius: radius.md, padding: '0 12px', fontSize: 15, fontFamily: fonts.regular, color: colors.text,
    backgroundColor: disabled ? colors.surfaceSunken : colors.surface, colorScheme: dark ? 'dark' : 'light', outline: 'none', minWidth: 0,
  };

  return (
    <View style={{ gap: 8 }}>
      <Text variant="smallStrong" tone="muted">Starts from</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {quick.map((q) => (
          <Chip key={q.label} label={q.label} selected={!!value && value.getTime() === q.date.getTime()} onPress={disabled ? undefined : () => onChange(q.date)} />
        ))}
      </View>
      {Platform.OS === 'web' ? (
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          {React.createElement('input', {
            type: 'date', 'aria-label': 'Date', disabled, min: isoDate(new Date()), value: value ? isoDate(value) : '',
            onChange: (e: { target: { value: string } }) => {
              const [y, m, d] = e.target.value.split('-').map(Number);
              if (!y || !m || !d) return onChange(null);
              const t = value ?? tomorrowMidnight();
              onChange(new Date(y, m - 1, d, t.getHours(), t.getMinutes(), 0, 0));
            },
            style: { ...webInputStyle, flex: '1 1 160px' },
          })}
          {React.createElement('input', {
            type: 'time', 'aria-label': 'Time', disabled, value: value ? isoTime(value) : '00:00',
            onChange: (e: { target: { value: string } }) => {
              const t = parseTime(e.target.value);
              if (!t || !value) return;
              onChange(new Date(value.getFullYear(), value.getMonth(), value.getDate(), t.h, t.min, 0, 0));
            },
            style: { ...webInputStyle, flex: '0 1 130px' },
          })}
        </View>
      ) : (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Input containerStyle={{ flex: 1 }} accessibilityLabel="Date" placeholder="DD/MM/YYYY" value={dateText} editable={!disabled}
            keyboardType="numbers-and-punctuation" maxLength={10}
            onChangeText={(t) => { setDateText(t); emit(t, timeText); }} icon="calendar-outline" />
          <Input containerStyle={{ width: 120 }} accessibilityLabel="Time" placeholder="HH:MM" value={timeText} editable={!disabled}
            keyboardType="numbers-and-punctuation" maxLength={5}
            onChangeText={(t) => { setTimeText(t); emit(dateText, t); }} icon="time-outline" />
        </View>
      )}
      {error ? <Text variant="small" tone="danger">{error}</Text> : (
        <Text variant="small" tone="subtle">Your device's time zone. Most GST changes start at midnight (00:00).</Text>
      )}
    </View>
  );
}

/** Big rate number with its split under it. */
export function RatePill({ rate, muted }: { rate: number | null; muted?: boolean }) {
  const { colors, radius } = useTheme();
  return (
    <View style={{ minWidth: 64, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.md, alignItems: 'center',
      backgroundColor: muted ? colors.surfaceSunken : colors.primarySoft }}>
      <Text variant="h2" color={muted ? colors.textMuted : colors.primarySoftText} style={{ fontVariant: ['tabular-nums'] }}>
        {rate === null ? '–' : `${formatRate(rate)}%`}
      </Text>
    </View>
  );
}
