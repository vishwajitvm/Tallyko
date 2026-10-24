import type { PublicMenu } from '@/api/types';
import { money, uuid } from '@/lib/format';
import type { PaymentChoice, PublicOrder, QrPaymentOptions } from './api';

export type MenuProduct = PublicMenu['products'][number];
export type OrderMode = 'QR' | 'ONLINE';

export interface CartLine {
  key: string; // product id + variant id
  productId: string;
  variantId: string | null;
  name: string;
  variantName: string | null;
  price: number;
  isVeg: boolean | null;
  qty: number;
  notes: string;
}

export interface PlacedOrder {
  id: string;
  code: string;
  token_no?: number | null;
  total_amount: number;
  status: string;
  placedAt: string;
  mode: OrderMode;
  orderType?: 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY';
  tableLabel?: string | null;
  /** Table QR orders: the table, the phone the bill belongs to and how the customer said they'd pay */
  tableId?: string | null;
  phone?: string | null;
  payment?: PaymentChoice;
  paid?: boolean;
}

export interface PublicOrderStatus {
  id: string;
  code: string;
  status: 'placed' | 'open' | 'completed' | 'cancelled' | string;
  payment_status: string;
  total_amount: number;
  token_no: number | null;
  items: { name: string; variant_name: string | null; quantity: number }[];
}

export interface CustomerDetails { name: string; phone: string; address: string; orderType: 'TAKEAWAY' | 'DELIVERY' }

export const MAX_QTY = 50;

export const lineKey = (productId: string, variantId: string | null) => `${productId}:${variantId ?? ''}`;

export const cartKey = (tenantId: string) => `tallyko.store.cart.${tenantId}`;
export const customerKey = (tenantId: string) => `tallyko.store.customer.${tenantId}`;
export const orderKey = (tenantId: string) => `tallyko.store.order.${tenantId}`;
/** Table QR: one remembered bill per table, so "Order more" adds to the same bill */
export const tableOrderKey = (tenantId: string, tableId: string) => `tallyko.store.table.${tenantId}.${tableId}`;

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Indian mobile number: optional +91 / 91 / 0 prefix, then 10 digits starting with 6–9. Returns the 10 digits or null. */
export function normaliseIndianMobile(input: string): string | null {
  let digits = input.replace(/[\s\-()]/g, '');
  if (digits.startsWith('+91')) digits = digits.slice(3);
  else if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

/** Client-generated order id so a retried "Place order" never creates a duplicate. */
export function newOrderId(): string {
  try {
    return uuid();
  } catch {
    // crypto.randomUUID needs a secure context; fall back to getRandomValues / Math.random
    const bytes = new Uint8Array(16);
    try {
      globalThis.crypto.getRandomValues(bytes);
    } catch {
      for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
}

/** Re-prices saved cart lines against the current menu and drops anything no longer sold. */
export function reconcileCart(lines: CartLine[], menu: Pick<PublicMenu, 'products'>): { lines: CartLine[]; removed: number } {
  const products = new Map(menu.products.map((p) => [p.id, p]));
  const out: CartLine[] = [];
  let removed = 0;
  for (const line of lines) {
    const p = products.get(line.productId);
    if (!p) { removed++; continue; }
    if (line.variantId) {
      const v = p.variants.find((x) => x.id === line.variantId);
      if (!v) { removed++; continue; }
      out.push({ ...line, name: p.name, variantName: v.name, price: v.price, isVeg: p.is_veg });
    } else if (p.variants.length) {
      removed++;
    } else {
      out.push({ ...line, name: p.name, price: p.price, isVeg: p.is_veg });
    }
  }
  return { lines: out, removed };
}

export function statusStage(status: string): 0 | 1 | 2 | -1 {
  if (status === 'cancelled') return -1;
  if (status === 'completed') return 2;
  if (status === 'open') return 1;
  return 0;
}

/** Menu-style price: ₹70 for whole rupees, ₹72.50 otherwise. */
export function price(value: number, symbol: string): string {
  return money(value, symbol, Number.isInteger(Math.round(value * 100) / 100));
}

// ---------- Table QR ordering ----------

/** "Table 7" for a table numbered "7"; labels that already say "Table …" are kept as they are. */
export function tableName(label: string | null | undefined): string {
  const l = (label ?? '').trim();
  if (!l) return 'your table';
  return /^table\b/i.test(l) ? l : `Table ${l}`;
}

/** Payment choices the shop allows for table orders, counter first. Always at least one. */
export function allowedPayments(options: QrPaymentOptions | null | undefined): PaymentChoice[] {
  if (!options) return ['counter'];
  const out: PaymentChoice[] = [];
  if (options.counter) out.push('counter');
  if (options.upi && options.upi_id) out.push('upi');
  return out.length ? out : ['counter'];
}

/** The customer's previous choice if it's still allowed, else the first allowed one. */
export function pickPayment(allowed: PaymentChoice[], preferred?: PaymentChoice | null): PaymentChoice {
  return preferred && allowed.includes(preferred) ? preferred : allowed[0] ?? 'counter';
}

export type TableStage = 'waiting' | 'kitchen' | 'served' | 'done' | 'cancelled';

/** Where a table order is: waiting for staff → in the kitchen → all served → closed (paid). */
export function tableStage(order: Pick<PublicOrder, 'status' | 'items'>): TableStage {
  if (order.status === 'cancelled') return 'cancelled';
  if (order.status === 'completed') return 'done';
  if (order.status === 'placed') return 'waiting';
  // Lines that never go to the kitchen (bottled water, packaged items) have no kitchen status: ignore them
  const tracked = (order.items ?? []).filter((i) => !!i.status);
  if (tracked.length && tracked.every((i) => i.status === 'served')) return 'served';
  return 'kitchen';
}

export type ItemTone = 'neutral' | 'primary' | 'warning' | 'success' | 'info';

/** Customer-friendly kitchen status of one line. */
export function itemStatus(status: string | null | undefined, orderStatus: string): { label: string; tone: ItemTone } {
  switch (status) {
    case 'served': return { label: 'Served', tone: 'success' };
    case 'ready': return { label: 'Ready', tone: 'info' };
    case 'preparing': return { label: 'Preparing', tone: 'warning' };
    case 'pending': return { label: 'In the kitchen', tone: 'primary' };
    default: return orderStatus === 'placed' ? { label: 'Waiting', tone: 'neutral' } : { label: 'Ordered', tone: 'neutral' };
  }
}

/** Amount still to pay. Older servers don't send balance_due: fall back to the total unless the bill is paid. */
export function balanceDue(order: Pick<PublicOrder, 'balance_due' | 'total_amount' | 'payment_status'>): number {
  if (typeof order.balance_due === 'number') return Math.max(0, order.balance_due);
  return order.payment_status === 'paid' ? 0 : Math.max(0, order.total_amount);
}

/** Rounding the server applied to the bill total (total = items − discount + GST + round off). */
export function billRoundOff(order: Pick<PublicOrder, 'total_amount' | 'subtotal' | 'tax_amount' | 'discount_amount'>): number {
  if (order.subtotal === undefined) return 0;
  const raw = order.subtotal - (order.discount_amount ?? 0) + (order.tax_amount ?? 0);
  return Math.round((order.total_amount - raw) * 100) / 100;
}

export type PayState = 'paid' | 'claimed' | 'due' | 'nothing';

export function paymentState(order: Pick<PublicOrder, 'balance_due' | 'total_amount' | 'payment_status' | 'payment_claim' | 'status'>): PayState {
  const due = balanceDue(order);
  if (order.payment_status === 'paid' || (order.total_amount > 0 && due <= 0)) return 'paid';
  if (order.payment_claim) return 'claimed';
  if (due > 0) return 'due';
  return 'nothing';
}

/**
 * Whether a upi:// link can open a UPI app here. Phones and tablets can; desktop browsers can't, so they get a QR
 * code to scan with the phone instead. iPadOS reports a Mac user agent, hence the touch-point check.
 */
export function canOpenUpiApp(os: string, userAgent = '', touchPoints = 0): boolean {
  if (os !== 'web') return true;
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(userAgent)) return true;
  return /Macintosh/i.test(userAgent) && touchPoints > 1;
}

/** UPI transaction reference (UTR) as typed: letters and digits only, at most 40. */
export function cleanUtr(input: string): string {
  return input.replace(/[^A-Za-z0-9]/g, '').slice(0, 40).toUpperCase();
}

/** Optional, but if given it should look like a reference (UPI UTRs are 12 digits). */
export function utrError(value: string): string | null {
  const v = cleanUtr(value);
  if (!v) return null;
  return v.length < 6 ? 'That looks too short. Leave it empty if you don’t have it.' : null;
}

/** A remembered table order is worth showing for a few hours; the next day it's someone else's table. */
export const TABLE_ORDER_TTL_MS = 8 * 3600 * 1000;

export function isActiveTableOrder(order: PlacedOrder | null, now = Date.now()): boolean {
  if (!order || order.mode !== 'QR') return false;
  if (now - new Date(order.placedAt).getTime() > TABLE_ORDER_TTL_MS) return false;
  return order.status === 'placed' || order.status === 'open';
}
