/**
 * Pure logic behind the floor screens (Tables, Kitchen, Online, Orders): timers, colour escalation,
 * filter counts. No React here, so every rule is unit-tested (see __tests__/floorLogic.test.ts).
 */
import type { OpsThresholds, TableBill, TableInfo } from '@/api/types';
import { paymentClaimOf } from '@/api/floor';
import { dayRange } from '@/lib/format';

// ---------------------------------------------------------------- time & escalation

/** ok → normal, warn → amber, late → red. */
export type AgeTone = 'ok' | 'warn' | 'late';
export interface AgeThresholds { warn: number; late: number }

/** Table running time: amber after 45 min, red after 75 min (defaults; the business sets its own in Settings → Floor alerts). */
export const TABLE_AGE: AgeThresholds = { warn: 45, late: 75 };
/** Kitchen ticket since its KOT: amber after 10 min, red after 20 min. */
export const KITCHEN_AGE: AgeThresholds = { warn: 10, late: 20 };
/** Online order waiting to be accepted: amber after 3 min, red after 6 min. */
export const ONLINE_AGE: AgeThresholds = { warn: 3, late: 6 };

export interface FloorAges { table: AgeThresholds; kitchen: AgeThresholds; online: AgeThresholds }

const okMin = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 1 ? Math.round(v) : null);

function pair(amber: unknown, red: unknown, fallback: AgeThresholds): AgeThresholds {
  const warn = okMin(amber) ?? fallback.warn;
  const late = okMin(red) ?? fallback.late;
  return late > warn ? { warn, late } : fallback;
}

/** The business's floor alert times (settings `ops_thresholds`), falling back to the defaults for missing or odd values. */
export function floorAges(t: Partial<OpsThresholds> | null | undefined): FloorAges {
  const online = okMin(t?.online_wait_min);
  return {
    table: pair(t?.table_amber_min, t?.table_red_min, TABLE_AGE),
    kitchen: pair(t?.kitchen_amber_min, t?.kitchen_red_min, KITCHEN_AGE),
    online: online ? { warn: online, late: online * 2 } : ONLINE_AGE,
  };
}

export function ageTone(minutes: number, t: AgeThresholds): AgeTone {
  if (minutes >= t.late) return 'late';
  if (minutes >= t.warn) return 'warn';
  return 'ok';
}

export function minutesBetween(iso: string | null | undefined, now: number): number {
  if (!iso) return 0;
  const at = new Date(iso).getTime();
  if (!Number.isFinite(at)) return 0;
  return Math.max(0, Math.floor((now - at) / 60000));
}

/** "Now", "42 min", "1 h 05", "26 h" — short enough for a compact tile. */
export function formatAge(minutes: number): string {
  if (minutes < 1) return 'Now';
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  if (h >= 24) return `${h} h`;
  return `${h} h ${String(minutes % 60).padStart(2, '0')}`;
}

/** "AK" from "Anil Kumar", "R" from "ravi", "" from nothing. */
export function initials(name: string | null | undefined): string {
  const parts = String(name ?? '').trim().split(/[^\p{L}]+/u).filter(Boolean); // letters only: "Ramesh (Head chef)" → RC
  if (!parts.length) return '';
  const first = parts[0]!.charAt(0);
  const last = parts.length > 1 ? parts[parts.length - 1]!.charAt(0) : '';
  return (first + last).toUpperCase();
}

// ---------------------------------------------------------------- tables

export type TableFilter = 'all' | 'free' | 'occupied' | 'ready' | 'payment';
/** What the tile colour says, most urgent first. */
export type TableState = 'free' | 'new' | 'payment' | 'ready' | 'occupied';

/** Every running bill on a table (several when a table is shared), oldest first. */
export function billsOf(t: TableInfo): TableBill[] {
  if (t.open_bills?.length) return t.open_bills;
  const o = t.current_order;
  return o && t.status === 'occupied'
    ? [{ id: o.id, code: o.code, bill_label: null, total_amount: o.total_amount, status: o.status, payment_status: 'unpaid',
      guests: null, customer_name: o.customer_name, waiter_id: null, waiter_name: null, created_at: o.created_at, kitchen: {} }]
    : [];
}

export function hasClaim(bill: TableBill, extraClaimIds?: ReadonlySet<string>): boolean {
  return !!paymentClaimOf(bill) || !!extraClaimIds?.has(bill.id);
}

export interface TableSummary {
  state: TableState;
  bills: TableBill[];
  total: number;
  guests: number;
  /** Minutes since the first (oldest) bill was opened. */
  minutes: number;
  /** Kitchen lines ready to take to the table. */
  ready: number;
  /** Kitchen lines still being made (pending + preparing). */
  cooking: number;
  upiToConfirm: boolean;
  newQr: boolean;
  waiterId: string | null;
  /** The bill's waiter, else the table's assigned waiter (names come with GET /tables). */
  waiterName: string | null;
}

/**
 * One table, summarised for the floor tile.
 * "Waiting payment": the guest said they paid by UPI, part of the bill is paid, or every kitchen line has been served.
 */
export function summarizeTable(t: TableInfo, now: number, extraClaimIds?: ReadonlySet<string>): TableSummary {
  const bills = billsOf(t);
  let total = 0; let guests = 0; let ready = 0; let cooking = 0; let served = 0; let partial = false; let upi = false; let newQr = false;
  for (const b of bills) {
    total += b.total_amount || 0;
    guests += b.guests ?? 0;
    const k = b.kitchen ?? {};
    ready += k.ready ?? 0;
    cooking += (k.pending ?? 0) + (k.preparing ?? 0);
    served += k.served ?? 0;
    if (b.payment_status === 'partial') partial = true;
    if (hasClaim(b, extraClaimIds)) upi = true;
    if (b.status === 'placed') newQr = true;
  }
  const oldest = bills.reduce<string | null>((acc, b) => (!acc || b.created_at < acc ? b.created_at : acc), null);
  const allServed = served > 0 && ready === 0 && cooking === 0;
  let state: TableState = 'free';
  if (bills.length) {
    if (newQr) state = 'new';
    else if (upi || partial || allServed) state = 'payment';
    else if (ready > 0) state = 'ready';
    else state = 'occupied';
  }
  const billWaiter = bills.find((b) => b.waiter_id);
  const waiterId = billWaiter?.waiter_id ?? t.assigned_staff_id ?? null;
  const waiterName = billWaiter ? billWaiter.waiter_name ?? null : t.assigned_staff_id ? t.assigned_staff_name ?? null : null;
  return {
    state, bills, total, guests, minutes: oldest ? minutesBetween(oldest, now) : 0, ready, cooking,
    upiToConfirm: upi, newQr, waiterId, waiterName,
  };
}

export function matchesTableFilter(s: Pick<TableSummary, 'state' | 'bills' | 'ready' | 'upiToConfirm'>, f: TableFilter): boolean {
  switch (f) {
    case 'all': return true;
    case 'free': return s.bills.length === 0;
    case 'occupied': return s.bills.length > 0;
    case 'ready': return s.ready > 0;
    case 'payment': return s.state === 'payment';
  }
}

export function tableFilterCounts(summaries: Pick<TableSummary, 'state' | 'bills' | 'ready' | 'upiToConfirm'>[]): Record<TableFilter, number> {
  const out: Record<TableFilter, number> = { all: 0, free: 0, occupied: 0, ready: 0, payment: 0 };
  for (const s of summaries) {
    (Object.keys(out) as TableFilter[]).forEach((f) => { if (matchesTableFilter(s, f)) out[f] += 1; });
  }
  return out;
}

export const NO_SECTION = 'Tables';

/** Sections in floor order with total and busy counts. */
export function sectionCounts(tables: Pick<TableInfo, 'section'>[], busy: (index: number) => boolean): { name: string; total: number; busy: number }[] {
  const map = new Map<string, { name: string; total: number; busy: number }>();
  tables.forEach((t, i) => {
    const name = t.section?.trim() || NO_SECTION;
    const row = map.get(name) ?? { name, total: 0, busy: 0 };
    row.total += 1;
    if (busy(i)) row.busy += 1;
    map.set(name, row);
  });
  return Array.from(map.values());
}

// ---------------------------------------------------------------- kitchen

export type KitchenKind = 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY' | 'SWIGGY' | 'ZOMATO';
export type KitchenKindFilter = 'all' | KitchenKind;

/** Which order-type filter a ticket falls under: delivery apps first, then the order type. */
export function ticketKind(t: { channel: string; type: string }): KitchenKind {
  if (t.channel === 'SWIGGY') return 'SWIGGY';
  if (t.channel === 'ZOMATO') return 'ZOMATO';
  if (t.type === 'DELIVERY') return 'DELIVERY';
  if (t.type === 'DINE_IN') return 'DINE_IN';
  return 'TAKEAWAY';
}

export function kindCounts(tickets: { channel: string; type: string }[]): Record<KitchenKindFilter, number> {
  const out: Record<KitchenKindFilter, number> = { all: tickets.length, DINE_IN: 0, TAKEAWAY: 0, DELIVERY: 0, SWIGGY: 0, ZOMATO: 0 };
  for (const t of tickets) out[ticketKind(t)] += 1;
  return out;
}

export type ItemStep = 'pending' | 'preparing' | 'ready' | 'served';
export const ITEM_FLOW: ItemStep[] = ['pending', 'preparing', 'ready', 'served'];
export type TicketStatus = 'pending' | 'preparing' | 'ready' | 'served' | 'cancelled';

export function nextItemStep(status: string): ItemStep | null {
  const i = ITEM_FLOW.indexOf(status as ItemStep);
  return ITEM_FLOW[(i < 0 ? 0 : i) + 1] ?? null;
}

export function prevItemStep(status: string): ItemStep | null {
  const i = ITEM_FLOW.indexOf(status as ItemStep);
  return i > 0 ? ITEM_FLOW[i - 1]! : null;
}

/** Next ticket status for the big Bump button. */
export function bumpTarget(status: TicketStatus): TicketStatus | null {
  if (status === 'pending') return 'preparing';
  if (status === 'preparing') return 'ready';
  if (status === 'ready') return 'served';
  return null;
}

/** A ticket follows its lines (as on the server): the least advanced live line; all cancelled → cancelled. */
export function ticketStatusFrom(items: { status: string; is_void: boolean }[], fallback: TicketStatus): TicketStatus {
  if (!items.length) return fallback;
  const live = items.filter((i) => !i.is_void);
  if (!live.length) return 'cancelled';
  const steps = live.map((i) => ITEM_FLOW.indexOf(i.status as ItemStep)).map((n) => (n < 0 ? 0 : n));
  return ITEM_FLOW[Math.min(...steps)]!;
}

// ---------------------------------------------------------------- new arrivals

/**
 * Ids in `ids` that weren't in `seen`. The first load (seen = null) never counts as "new",
 * so opening the screen doesn't beep for everything already waiting.
 */
export function freshIds(seen: ReadonlySet<string> | null, ids: string[]): string[] {
  if (!seen) return [];
  return ids.filter((id) => !seen.has(id));
}

/** Drop highlight marks older than `ttlMs`. */
export function pruneMarks(marks: Record<string, number>, now: number, ttlMs: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, at] of Object.entries(marks)) if (now - at < ttlMs) out[k] = at;
  return out;
}

// ---------------------------------------------------------------- orders

export type DatePreset = 'today' | 'yesterday' | 'week' | 'month' | 'any';
export const DATE_PRESETS: { key: DatePreset; label: string }[] = [
  { key: 'today', label: 'Today' }, { key: 'yesterday', label: 'Yesterday' }, { key: 'week', label: 'Last 7 days' },
  { key: 'month', label: 'Last 30 days' }, { key: 'any', label: 'Any date' },
];

export function datePresetRange(preset: DatePreset, now = new Date()): { from?: string; to?: string } {
  const y = now.getFullYear(); const m = now.getMonth(); const d = now.getDate();
  switch (preset) {
    case 'today': return dayRange(now);
    case 'yesterday': return dayRange(new Date(y, m, d - 1));
    case 'week': return dayRange(new Date(y, m, d - 6), 7);
    case 'month': return dayRange(new Date(y, m, d - 29), 30);
    case 'any': return {};
  }
}

export type OrderStatusFilter = 'all' | 'active' | 'placed' | 'completed' | 'cancelled' | 'merged';
/** `optional` chips only show when they have bills (or are selected). */
export const ORDER_STATUS_FILTERS: { key: OrderStatusFilter; label: string; optional?: boolean }[] = [
  { key: 'all', label: 'All' }, { key: 'active', label: 'Running' }, { key: 'placed', label: 'New' },
  { key: 'completed', label: 'Completed' }, { key: 'cancelled', label: 'Cancelled' }, { key: 'merged', label: 'Merged', optional: true },
];

/** Merge a refreshed first page into a long list without dropping what the user already scrolled to. */
export function mergeFirstPage<T extends { id: string }>(current: T[], firstPage: T[]): T[] {
  if (!current.length) return firstPage;
  const fresh = new Map(firstPage.map((o) => [o.id, o]));
  const known = new Set(current.map((o) => o.id));
  const added = firstPage.filter((o) => !known.has(o.id));
  const updated = current.map((o) => fresh.get(o.id) ?? o);
  return added.length ? [...added, ...updated] : updated;
}

/** Payment family for StatusPill: a claimed UPI payment wins, cancelled/merged bills show none. */
export function paymentPillStatus(o: { status: string; payment_status: string; payment_claim?: unknown }): string | null {
  if (o.status === 'cancelled' || o.status === 'merged') return null;
  if (o.payment_claim) return 'claim';
  return o.payment_status || 'unpaid';
}
