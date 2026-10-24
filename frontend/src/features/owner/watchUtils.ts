/** Pure helpers for the owner's watch: staff filtering, money lost per person and timeline grouping. */
import type { OwnerWatch, WatchEvent, WatchStaffRow, WatchTotals } from '@/api/owner';

export type WatchTab = 'bills' | 'items' | 'comps' | 'discounts' | 'menu' | 'timeline';

/** Money taken off bills by one person (cancelled bills, cancelled + removed items, discounts). */
export function staffLoss(row: WatchStaffRow): number {
  return round2(row.cancelled_bills_value + row.items_cancelled_value + row.items_removed_value + row.discount_value);
}

/** Everything taken off bills in the period. */
export function totalLoss(t: WatchTotals): number {
  return round2(t.cancelled_bills_value + t.items_cancelled_value + t.items_removed_value + t.on_the_house_value + t.discount_value);
}

export function rankStaff(rows: WatchStaffRow[]): WatchStaffRow[] {
  return [...rows].sort((a, b) => staffLoss(b) - staffLoss(a) || a.name.localeCompare(b.name));
}

/** People who show up anywhere in the period (for the staff filter), most money lost first. */
export function staffOptions(w: OwnerWatch): { id: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const r of rankStaff(w.by_staff)) if (r.staff_id) seen.set(r.staff_id, r.name);
  for (const e of w.events) if (e.by_staff_id && !seen.has(e.by_staff_id)) seen.set(e.by_staff_id, e.by ?? 'Staff');
  for (const m of w.menu_changes) if (m.changed_by_staff_id && !seen.has(m.changed_by_staff_id)) seen.set(m.changed_by_staff_id, m.changed_by ?? 'Staff');
  return [...seen].map(([id, name]) => ({ id, name }));
}

/**
 * The watch narrowed to one person. The server filters the activity log by staff_id; the other lists are narrowed here
 * (cancelled bills by the canceller's name, on-the-house from the activity log, which records who gave it).
 */
export function filterByStaff(w: OwnerWatch, staffId: string | null): { watch: OwnerWatch; totals: WatchTotals } {
  if (!staffId) return { watch: w, totals: w.totals };
  const row = w.by_staff.find((r) => r.staff_id === staffId);
  const name = row?.name ?? w.events.find((e) => e.by_staff_id === staffId)?.by ?? null;
  const events = w.events.filter((e) => e.by_staff_id === staffId);
  const comps = events.filter((e) => e.action === 'order.comp');
  const watch: OwnerWatch = {
    ...w,
    cancelled_bills: w.cancelled_bills.filter((b) => !!name && b.by === name),
    items: w.items.filter((i) => i.by_staff_id === staffId),
    menu_changes: w.menu_changes.filter((m) => m.changed_by_staff_id === staffId),
    events,
  };
  const totals: WatchTotals = {
    cancelled_bills: row?.cancelled_bills ?? 0,
    cancelled_bills_value: row?.cancelled_bills_value ?? 0,
    items_cancelled: row?.items_cancelled ?? 0,
    items_cancelled_value: row?.items_cancelled_value ?? 0,
    items_removed: row?.items_removed ?? 0,
    items_removed_value: row?.items_removed_value ?? 0,
    on_the_house: comps.length,
    on_the_house_value: round2(comps.reduce((s, e) => s + Number((e.details as { bill_comp_value?: number } | null)?.bill_comp_value ?? 0), 0)),
    discounted_bills: row?.discounts ?? 0,
    discount_value: row?.discount_value ?? 0,
    menu_changes: watch.menu_changes.length,
  };
  return { watch, totals };
}

/** Activity log grouped by local day, newest first. */
export function groupByDay(events: WatchEvent[], dayLabel: (iso: string) => string): { day: string; events: WatchEvent[] }[] {
  const groups: { day: string; events: WatchEvent[] }[] = [];
  const sorted = [...events].sort((a, b) => b.at.localeCompare(a.at));
  for (const e of sorted) {
    const day = dayLabel(e.at);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.events.push(e);
    else groups.push({ day, events: [e] });
  }
  return groups;
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
