import * as Crypto from 'expo-crypto';

const inr = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inrWhole = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

/** ₹1,23,456.50 — Indian digit grouping. `whole` drops paise for dashboards. */
export function money(value: number | null | undefined, symbol = '₹', whole = false): string {
  const n = Number.isFinite(value as number) ? (value as number) : 0;
  const sign = n < 0 ? '-' : '';
  return `${sign}${symbol}${(whole ? inrWhole : inr).format(Math.abs(n))}`;
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function uuid(): string {
  return Crypto.randomUUID();
}

export function shortCode(id: string): string {
  return id.replace(/-/g, '').slice(0, 10).toUpperCase();
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}, ${d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}`;
}

/** "just now", "5 min", "2 h", "3 d" */
export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const minutes = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  return `${Math.floor(hours / 24)} d`;
}

export function minutesSince(iso: string, now = Date.now()): number {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
}

export const ORDER_TYPE_LABEL: Record<string, string> = {
  DINE_IN: 'Dine-in', TAKEAWAY: 'Takeaway', DELIVERY: 'Delivery', RETAIL_WALKIN: 'Walk-in',
};

export const CHANNEL_LABEL: Record<string, string> = {
  POS: 'Counter', QR: 'QR table', ONLINE: 'Online store', SWIGGY: 'Swiggy', ZOMATO: 'Zomato', ONDC: 'ONDC', MAGICPIN: 'magicpin', OTHER: 'Phone / Other',
};

export const PAYMENT_LABEL: Record<string, string> = {
  CASH: 'Cash', CARD: 'Card', UPI: 'UPI', WALLET: 'Wallet', AGGREGATOR: 'Paid online', CREDIT: 'Credit (Udhaar)', OTHER: 'Other',
};

/** Local-day range as ISO strings with offset, so the server reports on the shop's calendar day. */
export function dayRange(date = new Date(), days = 1): { from: string; to: string } {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + days);
  return { from: toOffsetIso(start), to: toOffsetIso(end) };
}

export function toOffsetIso(d: Date): string {
  const pad = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, '0');
  const offset = -d.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(offset / 60)}:${pad(offset % 60)}`;
}
