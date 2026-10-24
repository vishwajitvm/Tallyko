/**
 * Offer editor state: form ↔ API conversion, validation (same rules as backend OfferIn) and the
 * plain-language preview sentence. Pure functions so they are unit-tested without rendering.
 */
import type { Offer, OfferBenefit, OfferInput, OfferKind, OfferState } from '@/api/offers';
import type { OrderType } from '@/api/types';
import { CHANNEL_LABEL, ORDER_TYPE_LABEL, money, toOffsetIso } from '@/lib/format';

export interface OfferForm {
  name: string;
  description: string;
  kind: OfferKind;
  benefit_type: OfferBenefit;
  value: string;
  max_discount: string;
  free_product_id: string | null;
  free_quantity: string;
  min_order: string;
  product_ids: string[];
  category_ids: string[];
  min_visits: string;
  window_days: string;
  /** 0 = Mon … 6 = Sun; empty = every day */
  days: number[];
  /** "HH:MM" or "" */
  start_time: string;
  end_time: string;
  /** "YYYY-MM-DD" local dates (end date inclusive) or "" */
  starts_on: string;
  ends_on: string;
  /** empty = every channel */
  channels: string[];
  /** empty = every order type */
  order_types: OrderType[];
  max_total: string;
  max_per_customer: string;
  priority: string;
  code: string;
  auto_apply: boolean;
  is_active: boolean;
  /** Kept as-is (set elsewhere); not edited here. */
  notify_email: boolean;
}

export type FormErrors = Partial<Record<keyof OfferForm, string>>;

/** 0 = Monday, as the server counts days. */
export const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export const ALL_ORDER_TYPES: OrderType[] = ['DINE_IN', 'TAKEAWAY', 'DELIVERY', 'RETAIL_WALKIN'];

export function emptyForm(kind: OfferKind = 'bill'): OfferForm {
  return {
    name: '', description: '', kind, benefit_type: 'percent', value: kind === 'loyalty' ? '20' : '', max_discount: '',
    free_product_id: null, free_quantity: '1', min_order: kind === 'loyalty' ? '500' : '', product_ids: [], category_ids: [],
    min_visits: kind === 'loyalty' ? '5' : '', window_days: kind === 'loyalty' ? '90' : '', days: [], start_time: '', end_time: '',
    starts_on: '', ends_on: '', channels: [], order_types: [], max_total: '', max_per_customer: kind === 'loyalty' ? '1' : '', priority: '0',
    code: '', auto_apply: kind !== 'items', is_active: true, notify_email: false,
  };
}

const pad = (n: number) => String(n).padStart(2, '0');
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const numText = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n));

export function fromOffer(o: Offer): OfferForm {
  return {
    name: o.name, description: o.description ?? '', kind: o.kind, benefit_type: o.benefit_type,
    value: o.benefit_type === 'free_item' ? '' : numText(o.benefit_value), max_discount: numText(o.max_discount),
    free_product_id: o.free_product_id, free_quantity: String(o.free_quantity || 1), min_order: o.min_order_amount ? String(o.min_order_amount) : '',
    product_ids: o.product_ids ?? [], category_ids: o.category_ids ?? [], min_visits: numText(o.min_visits), window_days: numText(o.visits_window_days),
    days: o.days_of_week ?? [], start_time: o.start_time ?? '', end_time: o.end_time ?? '',
    starts_on: o.starts_at ? localDate(new Date(o.starts_at)) : '',
    // stored as the moment the offer stops; shown as the last day it runs
    ends_on: o.ends_at ? localDate(new Date(new Date(o.ends_at).getTime() - 1)) : '',
    channels: o.channels ?? [], order_types: o.order_types ?? [], max_total: numText(o.max_uses_total),
    max_per_customer: numText(o.max_uses_per_customer), priority: String(o.priority ?? 0), code: o.code ?? '',
    auto_apply: o.auto_apply, is_active: o.is_active, notify_email: o.notify_email,
  };
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CODE_RE = /^[A-Za-z0-9_-]{3,20}$/;

function parseDate(text: string): Date | null {
  if (!DATE_RE.test(text)) return null;
  const [y, m, d] = text.split('-').map(Number) as [number, number, number];
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? date : null;
}

function num(text: string): number | null {
  const t = text.trim().replace(/,/g, '');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

const isInt = (n: number | null) => n !== null && Number.isInteger(n);

/** Field → message. Empty object = ready to save. */
export function validateForm(f: OfferForm): FormErrors {
  const e: FormErrors = {};
  const name = f.name.trim();
  if (name.length < 2) e.name = 'Give the offer a name (at least 2 letters)';
  else if (name.length > 80) e.name = 'Keep the name under 80 characters';
  if (f.description.length > 300) e.description = 'Keep the description under 300 characters';

  const value = num(f.value);
  if (f.benefit_type === 'percent') {
    if (value === null || Number.isNaN(value) || value <= 0 || value > 100) e.value = 'Enter a percent between 1 and 100';
  } else if (f.benefit_type === 'flat') {
    if (value === null || Number.isNaN(value) || value <= 0) e.value = 'Enter the amount to take off';
    else if (value > 1_000_000) e.value = 'That amount is too large';
  } else {
    if (!f.free_product_id) e.free_product_id = 'Choose the free item';
    const q = num(f.free_quantity);
    if (!isInt(q) || q! < 1 || q! > 20) e.free_quantity = 'Free quantity is 1 to 20';
  }
  const maxDisc = num(f.max_discount);
  if (f.benefit_type === 'percent' && maxDisc !== null && (Number.isNaN(maxDisc) || maxDisc <= 0)) e.max_discount = 'Enter a positive amount or leave it empty';

  const minOrder = num(f.min_order);
  if (minOrder !== null && (Number.isNaN(minOrder) || minOrder < 0)) e.min_order = 'Enter an amount or leave it empty';

  if (f.kind === 'items' && !f.product_ids.length && !f.category_ids.length) e.product_ids = 'Choose the items or categories this offer is for';
  if (f.kind === 'loyalty') {
    const visits = num(f.min_visits);
    if (!isInt(visits) || visits! < 1 || visits! > 1000) e.min_visits = 'Enter the number of visits (1 to 1000)';
    const days = num(f.window_days);
    if (days !== null && (!isInt(days) || days < 1 || days > 3650)) e.window_days = 'Days must be 1 to 3650, or leave it empty for all time';
  }

  const st = f.start_time.trim();
  const et = f.end_time.trim();
  if (st && !TIME_RE.test(st)) e.start_time = 'Use 24-hour time like 18:00';
  if (et && !TIME_RE.test(et)) e.end_time = 'Use 24-hour time like 22:30';
  if (!e.start_time && !e.end_time && !!st !== !!et) e[st ? 'end_time' : 'start_time'] = 'Set both a start and an end time';
  if (!e.start_time && !e.end_time && st && st === et) e.end_time = 'End time must be different from the start time';

  const sd = f.starts_on.trim();
  const ed = f.ends_on.trim();
  const start = sd ? parseDate(sd) : null;
  const end = ed ? parseDate(ed) : null;
  if (sd && !start) e.starts_on = 'Use a date like 2026-11-01';
  if (ed && !end) e.ends_on = 'Use a date like 2026-11-30';
  if (start && end && end < start) e.ends_on = 'The last day must be on or after the first day';

  const maxTotal = num(f.max_total);
  if (maxTotal !== null && (!isInt(maxTotal) || maxTotal < 1)) e.max_total = 'Whole number of uses, or leave it empty';
  const maxPer = num(f.max_per_customer);
  if (maxPer !== null && (!isInt(maxPer) || maxPer < 1)) e.max_per_customer = 'Whole number of uses, or leave it empty';
  const priority = num(f.priority);
  if (priority !== null && (!isInt(priority) || priority < 0 || priority > 1000)) e.priority = 'Priority is 0 to 1000';

  const code = f.code.trim();
  if (code && !CODE_RE.test(code)) e.code = '3–20 letters, numbers, - or _ (no spaces)';
  return e;
}

/** Form → API body. Call only when validateForm() returned no errors. */
export function toInput(f: OfferForm): OfferInput {
  const n = (t: string) => {
    const v = num(t);
    return v === null || Number.isNaN(v) ? null : v;
  };
  const start = f.starts_on ? parseDate(f.starts_on.trim()) : null;
  const end = f.ends_on ? parseDate(f.ends_on.trim()) : null;
  const endExclusive = end ? new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1) : null;
  const percent = f.benefit_type === 'percent';
  return {
    name: f.name.trim(),
    description: f.description.trim() || null,
    code: f.code.trim().toUpperCase() || null,
    kind: f.kind,
    benefit_type: f.benefit_type,
    benefit_value: f.benefit_type === 'free_item' ? 0 : n(f.value) ?? 0,
    max_discount: percent ? n(f.max_discount) : null,
    free_product_id: f.benefit_type === 'free_item' ? f.free_product_id : null,
    free_quantity: f.benefit_type === 'free_item' ? n(f.free_quantity) ?? 1 : 1,
    min_order_amount: n(f.min_order) ?? 0,
    product_ids: f.kind === 'items' ? f.product_ids : [],
    category_ids: f.kind === 'items' ? f.category_ids : [],
    min_visits: f.kind === 'loyalty' ? n(f.min_visits) : null,
    visits_window_days: f.kind === 'loyalty' ? n(f.window_days) : null,
    channels: f.channels.length ? f.channels : null,
    order_types: f.order_types.length && f.order_types.length < ALL_ORDER_TYPES.length ? f.order_types : null,
    days_of_week: f.days.length && f.days.length < 7 ? [...f.days].sort((a, b) => a - b) : null,
    start_time: f.start_time.trim() || null,
    end_time: f.end_time.trim() || null,
    starts_at: start ? toOffsetIso(start) : null,
    ends_at: endExclusive ? toOffsetIso(endExclusive) : null,
    auto_apply: f.auto_apply,
    is_active: f.is_active,
    priority: n(f.priority) ?? 0,
    max_uses_total: n(f.max_total),
    max_uses_per_customer: n(f.max_per_customer),
    notify_email: f.notify_email,
  };
}

// ---------------------------------------------------------------------------
// Plain-language preview
// ---------------------------------------------------------------------------

const amount = (text: string) => {
  const v = num(text);
  return v === null || Number.isNaN(v) ? null : money(v, '₹', Number.isInteger(v));
};

function listDays(days: number[]): string {
  const d = [...days].sort((a, b) => a - b);
  if (!d.length || d.length === 7) return '';
  if (d.join(',') === '0,1,2,3,4') return 'on weekdays';
  if (d.join(',') === '5,6') return 'on weekends';
  // consecutive run → "Fri–Sun"
  const run = d.every((x, i) => i === 0 || x === d[i - 1]! + 1);
  if (run && d.length > 2) return `${DAY_SHORT[d[0]!]}–${DAY_SHORT[d[d.length - 1]!]}`;
  return `on ${d.map((x) => DAY_SHORT[x]).join(', ')}`;
}

function shortDate(text: string): string | null {
  const d = parseDate(text.trim());
  return d ? d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : null;
}

/**
 * "Customers get 20% off (up to ₹150) on bills above ₹500 after 5 visits in 90 days, Fri–Sun 18:00–22:00,
 * from 1 Nov 2026 to 30 Nov 2026. Applied automatically. Max 1 per customer."
 */
export function previewSentence(f: OfferForm, names: { product: (id: string) => string | undefined; category: (id: string) => string | undefined; channel?: (code: string) => string }): string {
  const parts: string[] = [];
  let benefit: string;
  if (f.benefit_type === 'percent') {
    const v = num(f.value);
    benefit = v && !Number.isNaN(v) ? `${v}% off` : '…% off';
    const cap = amount(f.max_discount);
    if (cap) benefit += ` (up to ${cap})`;
  } else if (f.benefit_type === 'flat') {
    benefit = `${amount(f.value) ?? '₹…'} off`;
  } else {
    const q = num(f.free_quantity) || 1;
    const item = f.free_product_id ? names.product(f.free_product_id) ?? 'an item' : 'a free item';
    benefit = f.free_product_id ? `${q > 1 ? `${q} × ` : ''}${item} free` : 'a free item';
  }
  if (f.kind === 'items') {
    const picked = [...f.product_ids.map(names.product), ...f.category_ids.map((c) => { const n = names.category(c); return n ? `anything in ${n}` : undefined; })]
      .filter(Boolean) as string[];
    const scope = picked.length === 0 ? 'selected items' : picked.length <= 3 ? picked.join(', ') : `${picked.slice(0, 2).join(', ')} and ${picked.length - 2} more`;
    benefit += f.benefit_type === 'free_item' ? ` when they buy ${scope}` : ` on ${scope}`;
  }
  parts.push(`${f.kind === 'loyalty' ? 'Regular customers get' : 'Customers get'} ${benefit}`);
  const min = amount(f.min_order);
  if (min && num(f.min_order)! > 0) parts.push(`on bills above ${min}`);
  if (f.kind === 'loyalty') {
    const visits = num(f.min_visits);
    const window = num(f.window_days);
    parts.push(`after ${visits && !Number.isNaN(visits) ? visits : '…'} visits${window && !Number.isNaN(window) ? ` in the last ${window} days` : ''}`);
  }
  let text = parts.join(' ');

  const when: string[] = [];
  const days = listDays(f.days);
  if (days) when.push(days);
  if (f.start_time && f.end_time) when.push(`${f.start_time}–${f.end_time}${f.end_time < f.start_time ? ' (overnight)' : ''}`);
  const from = f.starts_on ? shortDate(f.starts_on) : null;
  const to = f.ends_on ? shortDate(f.ends_on) : null;
  if (from && to) when.push(`from ${from} to ${to}`);
  else if (from) when.push(`from ${from}`);
  else if (to) when.push(`until ${to}`);
  if (when.length) text += `, ${when.join(', ')}`;
  text += '.';

  const where: string[] = [];
  if (f.order_types.length && f.order_types.length < ALL_ORDER_TYPES.length) where.push(f.order_types.map((t) => ORDER_TYPE_LABEL[t] ?? t).join(' / '));
  if (f.channels.length) where.push(`on ${f.channels.map((c) => names.channel?.(c) ?? CHANNEL_LABEL[c] ?? c).join(', ')}`);
  if (where.length) text += ` ${where.join(' ')} orders only.`;

  const how: string[] = [];
  if (f.code.trim()) how.push(`Code ${f.code.trim().toUpperCase()}`);
  how.push(f.auto_apply ? 'Applied automatically when the bill qualifies' : 'Cashier applies it on the bill');
  text += ` ${how.join(' · ')}.`;

  const limits: string[] = [];
  const total = num(f.max_total);
  const per = num(f.max_per_customer);
  if (total && !Number.isNaN(total)) limits.push(`${total} uses in total`);
  if (per && !Number.isNaN(per)) limits.push(`${per} per customer`);
  if (limits.length) text += ` Limit: ${limits.join(', ')}.`;
  return text;
}

export const STATE_META: Record<OfferState, { label: string; tone: 'success' | 'info' | 'neutral' | 'warning' | 'danger' }> = {
  live: { label: 'Live', tone: 'success' },
  scheduled: { label: 'Scheduled', tone: 'info' },
  expired: { label: 'Expired', tone: 'neutral' },
  off: { label: 'Off', tone: 'neutral' },
  used_up: { label: 'Used up', tone: 'warning' },
};
