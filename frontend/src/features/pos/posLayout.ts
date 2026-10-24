/**
 * Pure layout and keyboard helpers for the billing screen (docs/20_High_Volume_UX.md §3):
 * adaptive cart width, fixed-size item grid / list metrics (so 300+ items virtualise smoothly),
 * arrow-key movement through the items, and payment-method defaults.
 */
import type { PaymentInput, PaymentMethod } from '@/api/types';

export type ProductView = 'grid' | 'list';

/** Cart panel next to the items: about 38% of the billing area, never narrower than 340 or wider than 440. */
export const CART_MIN = 340;
export const CART_MAX = 440;

export function cartWidthFor(bodyWidth: number): number {
  if (!(bodyWidth > 0)) return CART_MIN;
  // Wide screens get at least 360 (doc §3: tablet ≥ 360, desktop 400–440)
  const min = bodyWidth >= 1000 ? 360 : CART_MIN;
  return Math.round(Math.max(min, Math.min(CART_MAX, bodyWidth * 0.38)));
}

export interface GridMetrics {
  columns: number;
  tileWidth: number;
  /** Fixed tile height: rows can be laid out without measuring (getItemLayout). */
  tileHeight: number;
  gap: number;
  pad: number;
}

/** Item tiles for a pane of `width`. `dense` = phone or a narrow pane: smaller tiles, more per row. */
export function gridMetrics(width: number, dense: boolean): GridMetrics {
  const gap = dense ? 8 : 10;
  const pad = dense ? 12 : 16;
  const minTile = dense ? 104 : 148;
  const inner = Math.max(0, width - pad * 2);
  const fit = Math.floor((inner + gap) / (minTile + gap));
  const columns = Math.max(2, Math.min(8, fit || 2));
  const tileWidth = inner > 0 ? Math.floor((inner - gap * (columns - 1)) / columns) : minTile;
  return { columns, tileWidth, tileHeight: dense ? 76 : 86, gap, pad };
}

export interface ListMetrics {
  columns: number;
  rowHeight: number;
  pad: number;
  /** Horizontal gap between list columns. */
  gap: number;
}

/** Compact list rows: 52 px on touch, 44 px with a mouse; two or three columns when the pane is wide. */
export function listMetrics(width: number, finePointer: boolean): ListMetrics {
  const pad = width < 520 ? 12 : 16;
  const inner = Math.max(0, width - pad * 2);
  const columns = inner >= 1020 ? 3 : inner >= 640 ? 2 : 1;
  return { columns, rowHeight: finePointer ? 48 : 56, pad, gap: 16 };
}

/** Offset of virtualised row `index` when every row is `length` tall plus `gap` below it. */
export function rowLayout(length: number, gap: number, index: number) {
  return { length: length + gap, offset: (length + gap) * index, index };
}

export type Direction = 'left' | 'right' | 'up' | 'down';

/**
 * Highlighted item after an arrow key, in a grid of `columns` (1 for a list). Starts at the first item,
 * stays inside the list, and up/down keep the column where possible.
 */
export function moveHighlight(index: number, dir: Direction, columns: number, count: number): number {
  if (count <= 0) return -1;
  if (index < 0 || index >= count) return 0;
  const cols = Math.max(1, columns);
  switch (dir) {
    case 'left': return Math.max(0, index - 1);
    case 'right': return Math.min(count - 1, index + 1);
    case 'up': return index - cols >= 0 ? index - cols : index;
    case 'down': {
      if (index + cols < count) return index + cols;
      // Last, partly filled row: drop to its last item rather than doing nothing
      const lastRowStart = Math.floor((count - 1) / cols) * cols;
      return index < lastRowStart ? count - 1 : index;
    }
    default: return index;
  }
}

/** Scroll offset that brings row `row` into view (or null when it already is). */
export function scrollToReveal(row: number, rowSpan: number, viewport: number, scrollY: number, topInset = 0): number | null {
  const top = topInset + row * rowSpan;
  const bottom = top + rowSpan;
  if (top < scrollY) return Math.max(0, top - 8);
  if (bottom > scrollY + viewport) return Math.max(0, bottom - viewport + 8);
  return null;
}

/** Looks like something a barcode scanner typed (worth asking the server about if nothing local matches). */
export function isLikelyCode(text: string): boolean {
  const t = text.trim();
  return /^[0-9]{6,14}$/.test(t) || (/^[0-9A-Za-z\-.]{4,48}$/.test(t) && /[0-9]/.test(t) && !/\s/.test(t));
}

/**
 * Method the payment sheet starts on: aggregator bills are paid online; otherwise the method used last
 * (never Udhaar — credit is a deliberate choice), else cash.
 */
export function defaultPaymentMethod(opts: { aggregator: boolean; last: PaymentMethod | null }): PaymentMethod {
  if (opts.aggregator) return 'AGGREGATOR';
  if (opts.last && opts.last !== 'CREDIT' && opts.last !== 'AGGREGATOR') return opts.last;
  return 'CASH';
}

/** The method to remember after a bill is paid: the one that took the most money (credit / aggregator never). */
export function methodToRemember(payments: Pick<PaymentInput, 'method' | 'amount'>[]): PaymentMethod | null {
  let best: Pick<PaymentInput, 'method' | 'amount'> | null = null;
  for (const p of payments) {
    if (p.method === 'CREDIT' || p.method === 'AGGREGATOR') continue;
    if (!best || p.amount > best.amount) best = p;
  }
  return best?.method ?? null;
}

/**
 * Quick-cash notes for an amount due: exact, then the next round amounts a customer is likely to hand over
 * (₹340 → 350, 400, 500, 2000). At most `max` values, all ≥ due, no duplicates.
 */
export function cashNotes(due: number, max = 5): number[] {
  if (!(due > 0)) return [];
  const out = [Math.round(due * 100) / 100];
  for (const step of [10, 50, 100, 500, 2000]) {
    const v = Math.ceil(due / step) * step;
    if (v > due + 0.001 && !out.includes(v)) out.push(v);
  }
  return out.slice(0, max);
}
