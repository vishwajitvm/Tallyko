/**
 * The owner's watch tabs as flat rows for one virtualised DataList (table on desktop, cards elsewhere).
 * Pure: no React, unit-tested.
 */
import type { OwnerWatch, WatchEvent, WatchTotals } from '@/api/owner';
import type { WatchTab } from './watchUtils';

export type WatchView = 'staff' | WatchTab | 'requests';

export type RowTone = 'danger' | 'warning' | 'accent' | 'info' | 'primary' | 'neutral';

export interface WatchRow {
  key: string;
  /** Activity kind for the icon: an audit action ("order.cancel") or "bill" / "item.after" / "item.before" / "comp" / "menu" */
  kind: string;
  title: string;
  badges: { label: string; tone: RowTone }[];
  /** Reason or what changed */
  detail: string;
  by: string | null;
  at: string | null;
  amount: number | null;
  /** Bill to open, when there is one */
  orderId: string | null;
}

const quote = (s: string | null | undefined) => (s ? `“${s}”` : 'No reason given');

function eventRow(e: WatchEvent): WatchRow {
  const details = (e.details ?? {}) as Record<string, unknown>;
  const orderId = typeof details.order_id === 'string' ? details.order_id : null;
  const amount = typeof details.amount === 'number' ? details.amount
    : typeof details.bill_comp_value === 'number' ? details.bill_comp_value : null;
  return { key: e.id, kind: e.action, title: e.label, badges: [], detail: e.summary ?? '', by: e.by, at: e.at, amount, orderId };
}

/** Rows for a tab ('staff' and 'requests' have their own lists and return []). `filtered` = narrowed to one person. */
export function watchRows(tab: WatchView, w: OwnerWatch, filtered: boolean): WatchRow[] {
  switch (tab) {
    case 'bills':
      return w.cancelled_bills.map((b) => ({
        key: b.id, kind: 'order.cancel', title: `Bill ${b.bill}`, badges: [], detail: quote(b.reason), by: b.by, at: b.cancelled_at, amount: b.total, orderId: b.id,
      }));
    case 'items':
      return w.items.map((it, i) => ({
        key: `${it.order_id}-${i}`,
        kind: it.after_kitchen ? 'order.void_item' : 'order.remove_item',
        title: `${it.quantity} × ${it.name}${it.variant ? ` (${it.variant})` : ''}`,
        badges: [
          { label: it.after_kitchen ? 'After kitchen' : 'Before kitchen', tone: it.after_kitchen ? 'danger' : 'warning' },
          ...(it.bill_status === 'cancelled' ? [{ label: 'Bill cancelled', tone: 'neutral' as RowTone }] : []),
        ],
        detail: `${quote(it.reason)} · Bill ${it.bill}`,
        by: it.by, at: it.at, amount: it.value, orderId: it.order_id,
      }));
    case 'comps':
      if (filtered) return w.events.filter((e) => e.action === 'order.comp').map(eventRow);
      return w.on_the_house.map((c, i) => ({
        key: `${c.order_id}-${i}`, kind: 'order.comp', title: `${c.quantity} × ${c.name}`, badges: [], detail: `${quote(c.reason)} · Bill ${c.bill}`,
        by: null, at: null, amount: c.value, orderId: c.order_id,
      }));
    case 'discounts':
      return w.events.filter((e) => e.action === 'order.discount').map(eventRow);
    case 'menu':
      return w.menu_changes.map((m) => ({
        key: `${m.product_id}-${m.version}`, kind: /removed from the menu/i.test(m.change) ? 'menu.remove' : 'menu.change', title: m.name,
        badges: [{ label: `Version ${m.version}`, tone: 'neutral' }], detail: m.change, by: m.changed_by, at: m.created_at, amount: null, orderId: null,
      }));
    case 'timeline':
      return [...w.events].sort((a, b) => b.at.localeCompare(a.at)).map(eventRow);
    default:
      return [];
  }
}

export function viewCount(tab: WatchView, w: OwnerWatch, totals: WatchTotals, requests: number): number {
  switch (tab) {
    case 'staff': return w.by_staff.length;
    case 'bills': return w.cancelled_bills.length;
    case 'items': return w.items.length;
    case 'comps': return totals.on_the_house;
    case 'discounts': return w.events.filter((e) => e.action === 'order.discount').length;
    case 'menu': return w.menu_changes.length;
    case 'timeline': return Math.max(w.events_total ?? 0, w.events.length);
    case 'requests': return requests;
  }
}
