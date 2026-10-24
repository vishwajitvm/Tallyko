/** Pure helpers for the Inventory screen (filters, counts, optimistic quick adjustments, barcode scanner bursts). */
import type { StockRow } from '@/api/types';
import { normName } from '../utils';

export type StockFilter = 'all' | 'low' | 'out';

export function stockCounts(rows: readonly StockRow[]): { all: number; low: number; out: number } {
  let low = 0;
  let out = 0;
  for (const r of rows) {
    if (r.stock <= 0) out += 1;
    if (r.is_low) low += 1;
  }
  return { all: rows.length, low, out };
}

/** Search matches name, barcode or category name; low = at/below alert level (includes out of stock). */
export function filterStock(rows: readonly StockRow[], filter: StockFilter, query: string, categoryName?: (id: string | null) => string | null): StockRow[] {
  const q = normName(query);
  const list = rows.filter((r) => {
    if (filter === 'low' && !r.is_low) return false;
    if (filter === 'out' && r.stock > 0) return false;
    if (!q) return true;
    return normName(r.name).includes(q) || (r.barcode ?? '').toLowerCase().includes(q) || normName(categoryName?.(r.category_id) ?? '').includes(q);
  });
  // Lowest stock first when looking at problems; otherwise low items first, then by name
  if (filter !== 'all') return list.sort((a, b) => a.stock - b.stock || a.name.localeCompare(b.name));
  return list.sort((a, b) => Number(b.is_low) - Number(a.is_low) || a.name.localeCompare(b.name));
}

/** The row after a stock change (optimistic UI before the server answers). */
export function applyStockChange(row: StockRow, change: number): StockRow {
  const stock = row.stock + change;
  return {
    ...row,
    stock,
    is_low: stock <= row.low_stock_threshold,
    stock_value: Math.max(stock, 0) * (row.cost_price ?? 0),
  };
}

export function clampQty(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(9999, Math.round(n)));
}

/**
 * USB / Bluetooth barcode scanners "type" a code very fast and press Enter. Feed every key here: it returns the
 * scanned code when a fast burst (≤ `maxGapMs` between keys, at least `minLength` characters) ends with Enter.
 */
export function createScanBuffer(opts: { maxGapMs?: number; minLength?: number } = {}) {
  const { maxGapMs = 45, minLength = 6 } = opts;
  let buffer = '';
  let last = 0;
  return (key: string, at: number): string | null => {
    if (at - last > maxGapMs) buffer = '';
    last = at;
    if (key === 'Enter') {
      const code = buffer;
      buffer = '';
      return code.length >= minLength ? code : null;
    }
    if (key.length === 1) buffer += key;
    else buffer = '';
    return null;
  };
}
