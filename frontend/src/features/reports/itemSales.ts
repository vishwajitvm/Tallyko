/** Pure helpers for the item-wise sales table (search, sort, totals). Unit-tested. */
import type { ItemRow } from './useReports';

export type ItemSortKey = 'name' | 'qty' | 'revenue' | 'tax' | 'share';
export interface ItemSort { key: ItemSortKey | string; dir: 'asc' | 'desc' }

export const itemKey = (r: Pick<ItemRow, 'name' | 'variant'>) => `${r.name}|${r.variant ?? ''}`;

export function filterItems(rows: readonly ItemRow[], q: string): ItemRow[] {
  const t = q.trim().toLowerCase();
  if (!t) return [...rows];
  return rows.filter((r) => r.name.toLowerCase().includes(t) || (r.variant ?? '').toLowerCase().includes(t));
}

export function sortItems(rows: readonly ItemRow[], sort: ItemSort): ItemRow[] {
  const sign = sort.dir === 'asc' ? 1 : -1;
  const v = (r: ItemRow): number | string => {
    switch (sort.key) {
      case 'name': return `${r.name} ${r.variant ?? ''}`.toLowerCase();
      case 'qty': return r.quantity;
      case 'tax': return r.tax;
      default: return r.revenue;
    }
  };
  return [...rows].sort((a, b) => {
    const x = v(a);
    const y = v(b);
    const c = typeof x === 'string' && typeof y === 'string' ? x.localeCompare(y) : (x as number) - (y as number);
    return c * sign || b.revenue - a.revenue || a.name.localeCompare(b.name);
  });
}

export function itemTotals(rows: readonly ItemRow[]): { qty: number; revenue: number; tax: number } {
  return rows.reduce((t, r) => ({ qty: t.qty + r.quantity, revenue: t.revenue + r.revenue, tax: t.tax + r.tax }), { qty: 0, revenue: 0, tax: 0 });
}

/** Share of revenue as "12.5%" ("<0.1%" for tiny ones, "" when there is no revenue). */
export function shareLabel(part: number, total: number): string {
  if (total <= 0) return '';
  const pct = (part / total) * 100;
  if (pct > 0 && pct < 0.1) return '<0.1%';
  return `${pct >= 10 ? pct.toFixed(0) : pct.toFixed(1)}%`;
}
