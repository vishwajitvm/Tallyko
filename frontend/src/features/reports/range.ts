import { toOffsetIso } from '@/lib/format';

export type PresetId = 'today' | 'yesterday' | '7d' | '30d' | 'month' | 'custom';

export interface ReportRange {
  preset: PresetId;
  /** Local midnight of the first day. */
  start: Date;
  /** Local midnight AFTER the last day (exclusive). */
  end: Date;
}

export const PRESETS: { id: Exclude<PresetId, 'custom'>; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: '7d', label: 'Last 7 days' },
  { id: '30d', label: 'Last 30 days' },
  { id: 'month', label: 'This month' },
];

const MAX_DAYS = 366;

function midnight(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

export function presetRange(id: Exclude<PresetId, 'custom'>, now = new Date()): ReportRange {
  const today = midnight(now);
  switch (id) {
    case 'today': return { preset: id, start: today, end: addDays(today, 1) };
    case 'yesterday': return { preset: id, start: addDays(today, -1), end: today };
    case '7d': return { preset: id, start: addDays(today, -6), end: addDays(today, 1) };
    case '30d': return { preset: id, start: addDays(today, -29), end: addDays(today, 1) };
    case 'month': return { preset: id, start: new Date(today.getFullYear(), today.getMonth(), 1), end: addDays(today, 1) };
  }
}

export function rangeQuery(r: ReportRange): { from: string; to: string } {
  return { from: toOffsetIso(r.start), to: toOffsetIso(r.end) };
}

export function rangeDays(r: ReportRange): number {
  return Math.round((r.end.getTime() - r.start.getTime()) / 86_400_000);
}

export function isSingleDay(r: ReportRange): boolean {
  return rangeDays(r) === 1;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dayFmt = (d: Date, withYear = true) => `${d.getDate()} ${MONTHS[d.getMonth()]}${withYear ? ` ${d.getFullYear()}` : ''}`;

/** "Fri, 23 Oct 2026" or "17 Oct – 23 Oct 2026" */
export function rangeLabel(r: ReportRange): string {
  const last = addDays(r.end, -1);
  if (isSingleDay(r)) return `${WEEKDAYS[r.start.getDay()]}, ${dayFmt(r.start)}`;
  const sameYear = r.start.getFullYear() === last.getFullYear();
  return `${dayFmt(r.start, !sameYear)} – ${dayFmt(last)}`;
}

/** YYYY-MM-DD in local time. */
export function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function rangeSlug(r: ReportRange): string {
  return isSingleDay(r) ? ymd(r.start) : `${ymd(r.start)}_to_${ymd(addDays(r.end, -1))}`;
}

/** Parses a strict YYYY-MM-DD into a local Date, or null if invalid (e.g. 2026-02-30). */
export function parseYmd(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return date;
}

export function validateCustom(fromText: string, toText: string, now = new Date()):
  { range: ReportRange; errors?: undefined } | { range?: undefined; errors: { from?: string; to?: string } } {
  const errors: { from?: string; to?: string } = {};
  const from = parseYmd(fromText);
  const to = parseYmd(toText);
  const today = midnight(now);
  if (!fromText.trim()) errors.from = 'Enter a start date';
  else if (!from) errors.from = 'Use YYYY-MM-DD, e.g. 2026-10-01';
  if (!toText.trim()) errors.to = 'Enter an end date';
  else if (!to) errors.to = 'Use YYYY-MM-DD, e.g. 2026-10-23';
  if (from && from > today) errors.from = 'Start date is in the future';
  if (to && to > today) errors.to = 'End date is in the future';
  if (from && to && !errors.from && !errors.to) {
    if (to < from) errors.to = 'End date is before the start date';
    else if ((to.getTime() - from.getTime()) / 86_400_000 + 1 > MAX_DAYS) errors.to = `Pick at most ${MAX_DAYS} days`;
  }
  if (errors.from || errors.to || !from || !to) return { errors };
  return { range: { preset: 'custom', start: from, end: addDays(to, 1) } };
}

/** Hour label: 0 → "12 AM", 13 → "1 PM". */
export function hourLabel(h: number, short = false): string {
  const hr = h % 12 === 0 ? 12 : h % 12;
  const suffix = h < 12 ? (short ? 'a' : ' AM') : (short ? 'p' : ' PM');
  return `${hr}${suffix}`;
}
