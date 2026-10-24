/**
 * Pure helpers for the running bill on the floor: which items can be selected, what the selection allows
 * (mark ready / served, cancel, on the house, move, repeat), kitchen progress and bill labels.
 * Mirrors backend/app/services/floor_service.py so the app only offers what the server will accept.
 */
import type { KitchenStatus, Order, OrderItem, TableBill } from '@/api/types';
import type { ItemQty, ItemStatus } from '@/api/floor';
import { isCompItem, isFreeItem, isVoidItem } from '@/lib/billing';

export const KITCHEN_FLOW: ItemStatus[] = ['pending', 'preparing', 'ready', 'served'];

export const KITCHEN_META: Record<KitchenStatus, { label: string; tone: 'neutral' | 'info' | 'success' | 'primary' | 'danger' | 'warning'; icon: string }> = {
  pending: { label: 'Pending', tone: 'warning', icon: 'time-outline' },
  preparing: { label: 'Preparing', tone: 'info', icon: 'flame-outline' },
  ready: { label: 'Ready', tone: 'success', icon: 'checkmark-circle-outline' },
  served: { label: 'Served', tone: 'neutral', icon: 'checkmark-done-outline' },
  void: { label: 'Cancelled', tone: 'danger', icon: 'close-circle-outline' },
};

/** Items a person can tick: everything except cancelled lines. */
export function selectableItems(items: OrderItem[]): OrderItem[] {
  return items.filter((i) => !isVoidItem(i));
}

export interface Selection {
  /** Selected live lines, in bill order. */
  items: OrderItem[];
  /** Lines that go through the kitchen (can be marked preparing / ready / served). */
  kitchen: OrderItem[];
  /** Can be cancelled (offer freebies follow their offer instead). */
  voidable: OrderItem[];
  /** Some voidable lines already reached the kitchen: a reason (and `orders.void_item`) is needed. */
  anySent: boolean;
  /** Can go on the house (not already free, not a freebie). */
  compable: OrderItem[];
  /** Can move to another bill. */
  movable: OrderItem[];
  /** Can be ordered again as a new KOT. */
  repeatable: OrderItem[];
  /** Quantity of the selected lines. */
  quantity: number;
}

export function describeSelection(items: OrderItem[], selected: ReadonlySet<string>): Selection {
  const picked = selectableItems(items).filter((i) => selected.has(i.id));
  const voidable = picked.filter((i) => !isFreeItem(i));
  return {
    items: picked,
    kitchen: picked.filter((i) => !!i.kitchen_status && i.kitchen_status !== 'void'),
    voidable,
    anySent: voidable.some(isSent),
    compable: picked.filter((i) => !isFreeItem(i) && !isCompItem(i)),
    movable: voidable,
    repeatable: voidable,
    quantity: picked.reduce((s, i) => s + i.quantity, 0),
  };
}

/** Reached the kitchen (has a KOT). Unsent lines are simply removed when cancelled. */
export function isSent(item: Pick<OrderItem, 'kot_id' | 'sent_to_kitchen'>): boolean {
  return !!item.kot_id || !!item.sent_to_kitchen;
}

/**
 * The status the selection should move to next: one step past its least advanced line
 * (2 ready + 2 still cooking → "ready"). Null when everything is served.
 */
export function nextKitchenStatus(items: Pick<OrderItem, 'kitchen_status'>[]): ItemStatus | null {
  const steps = items.map((i) => KITCHEN_FLOW.indexOf((i.kitchen_status ?? 'pending') as ItemStatus)).filter((n) => n >= 0);
  if (!steps.length) return null;
  const least = Math.min(...steps);
  return least >= KITCHEN_FLOW.length - 1 ? null : KITCHEN_FLOW[least + 1]!;
}

/** Lines per kitchen status (cancelled lines left out) — same shape as `TableBill.kitchen`. */
export function kitchenCounts(items: Pick<OrderItem, 'kitchen_status' | 'is_void'>[]): TableBill['kitchen'] {
  const out: TableBill['kitchen'] = {};
  for (const i of items) {
    const s = i.kitchen_status;
    if (!s || s === 'void' || i.is_void) continue;
    out[s] = (out[s] ?? 0) + 1;
  }
  return out;
}

/** What a waiter should see first about a bill's kitchen progress ("2 ready to serve", "3 cooking"). */
export function kitchenProgress(kitchen: TableBill['kitchen'] | null | undefined): { label: string; tone: 'success' | 'info' | 'warning' | 'neutral' } | null {
  const k = kitchen ?? {};
  const ready = k.ready ?? 0;
  const cooking = (k.pending ?? 0) + (k.preparing ?? 0);
  if (ready) return { label: `${ready} ready to serve`, tone: 'success' };
  if (k.preparing) return { label: `${cooking} cooking`, tone: 'info' };
  if (k.pending) return { label: `${k.pending} waiting`, tone: 'warning' };
  if (k.served) return { label: 'All served', tone: 'neutral' };
  return null;
}

/** Name of a bill on a shared table: its own label, else its position ("Bill 2"). */
export function billName(bill: Pick<Order, 'bill_label'> | Pick<TableBill, 'bill_label'>, index: number): string {
  return bill.bill_label?.trim() || `Bill ${index + 1}`;
}

/** Turn the chosen quantities into API lines; a full line is sent without a quantity. */
export function toItemQty(items: OrderItem[], qty: Record<string, number>): ItemQty[] {
  return items
    .map((i) => ({ item: i, n: Math.max(0, Math.min(i.quantity, Math.floor(qty[i.id] ?? i.quantity))) }))
    .filter((x) => x.n > 0)
    .map(({ item, n }) => (n >= item.quantity ? { item_id: item.id } : { item_id: item.id, quantity: n }));
}

/** Keep only ids that are still selectable on the (refreshed) bill. */
export function pruneSelection(items: OrderItem[], selected: ReadonlySet<string>): Set<string> {
  const live = new Set(selectableItems(items).map((i) => i.id));
  return new Set([...selected].filter((id) => live.has(id)));
}

/** Bills on payment can't change items (server: "Items can't change after a payment was taken"). */
export function itemsLocked(order: Pick<Order, 'paid_amount' | 'payments'>): boolean {
  return (order.paid_amount ?? 0) > 0 || (order.payments?.length ?? 0) > 0;
}
