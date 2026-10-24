/**
 * Pure helpers for the menu list and its bulk actions (selection bar): filtering, counting, sorting,
 * bulk price maths and a small concurrency pool that reports progress and failures.
 * No React here, so it is unit-tested.
 */
import type { Product } from '@/api/types';
import { round2 } from '@/lib/format';
import { MAX_PRICE, normName } from './utils';
import type { ChannelPrices } from '@/api/channels';
import { cleanChannelPrices, entryOf, isOnChannel } from './channelPricing';

/** Hide an item from (or show it on) one channel; its own price there is kept. Null when nothing changes. */
export function withChannelAvailability(prices: ChannelPrices | null | undefined, code: string, available: boolean): ChannelPrices | null {
  const key = code.toUpperCase();
  const current = entryOf(prices, key);
  if ((current.available !== false) === available) return null;
  const next: Record<string, { price?: number; available?: boolean }> = { ...(prices ?? {}) };
  next[key] = { ...current, available: available ? undefined : false };
  return cleanChannelPrices(next);
}

// ---------------------------------------------------------------------------------------------------------------
// Filtering, counts, sorting
// ---------------------------------------------------------------------------------------------------------------

/** 'all' | 'none' (uncategorised) | 'removed' | a category id */
export type MenuFilter = 'all' | 'none' | 'removed' | string;

export interface MenuQuery {
  filter: MenuFilter;
  /** Raw search text: matches name, SKU and barcode. */
  query: string;
  /** Channel code whose menu is shown (null = counter / everything active). */
  channel: string | null;
  /** Category ids that still exist (items pointing elsewhere count as uncategorised). */
  categoryIds: ReadonlySet<string>;
}

export function matchesSearch(p: Pick<Product, 'name' | 'sku' | 'barcode'>, query: string): boolean {
  const q = normName(query);
  if (!q) return true;
  return normName(p.name).includes(q) || (p.sku ?? '').toLowerCase().includes(q) || (p.barcode ?? '').toLowerCase().includes(q);
}

export function filterMenu(products: readonly Product[], { filter, query, channel, categoryIds }: MenuQuery): Product[] {
  return products.filter((p) => {
    if (filter === 'removed') {
      if (p.is_active) return false;
    } else {
      if (!p.is_active) return false;
      if (channel && !isOnChannel(p, channel)) return false;
      const known = !!p.category_id && categoryIds.has(p.category_id);
      if (filter === 'none' && known) return false;
      if (filter !== 'all' && filter !== 'none' && p.category_id !== filter) return false;
    }
    return matchesSearch(p, query);
  });
}

/** Counts per category chip, for the active items on the current channel menu and the current search. */
export function menuCounts(products: readonly Product[], q: Omit<MenuQuery, 'filter'>): { all: number; none: number; removed: number; byCategory: Record<string, number> } {
  const byCategory: Record<string, number> = {};
  let all = 0;
  let none = 0;
  let removed = 0;
  for (const p of products) {
    if (!matchesSearch(p, q.query)) continue;
    if (!p.is_active) { removed += 1; continue; }
    if (q.channel && !isOnChannel(p, q.channel)) continue;
    all += 1;
    if (p.category_id && q.categoryIds.has(p.category_id)) byCategory[p.category_id] = (byCategory[p.category_id] ?? 0) + 1;
    else none += 1;
  }
  return { all, none, removed, byCategory };
}

export type MenuSortKey = 'name' | 'category' | 'price' | 'stock' | 'gst';
export interface MenuSort { key: MenuSortKey | string; dir: 'asc' | 'desc' }

/**
 * Default order = menu order (category order, then the item's own order, then name). Column sorts fall back to it.
 * `categoryRank` maps category id → position; `stock` maps product id → quantity on hand (tracked items only).
 */
export function sortMenu(
  list: readonly Product[], sort: MenuSort | null, categoryRank: ReadonlyMap<string, number>, stock?: ReadonlyMap<string, number>,
  gst?: (p: Product) => number,
): Product[] {
  const rank = (p: Product) => (p.category_id && categoryRank.has(p.category_id) ? categoryRank.get(p.category_id)! : Number.MAX_SAFE_INTEGER);
  const menuOrder = (a: Product, b: Product) => rank(a) - rank(b) || a.sort_order - b.sort_order || a.name.localeCompare(b.name);
  if (!sort) return [...list].sort(menuOrder);
  const dir = sort.dir === 'desc' ? -1 : 1;
  const value = (p: Product): number | string => {
    switch (sort.key) {
      case 'name': return p.name.toLowerCase();
      case 'category': return rank(p);
      case 'price': return p.base_price;
      case 'gst': return gst ? gst(p) : 0;
      case 'stock': return stock?.has(p.id) ? stock.get(p.id)! : Number.NEGATIVE_INFINITY;
      default: return 0;
    }
  };
  return [...list].sort((a, b) => {
    const x = value(a);
    const y = value(b);
    const c = typeof x === 'string' && typeof y === 'string' ? x.localeCompare(y) : (x as number) - (y as number);
    return c * dir || menuOrder(a, b);
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Bulk prices
// ---------------------------------------------------------------------------------------------------------------

export type PriceOp =
  | { mode: 'set'; value: number }
  | { mode: 'percent'; value: number; roundToRupee: boolean }
  | { mode: 'amount'; value: number };

function applyOne(price: number, op: PriceOp): number {
  let next: number;
  if (op.mode === 'set') next = op.value;
  else if (op.mode === 'amount') next = price + op.value;
  else {
    const raw = price * (1 + op.value / 100);
    next = op.roundToRupee ? Math.round(raw + 1e-9) : raw;
  }
  return Math.min(MAX_PRICE, Math.max(0, round2(next)));
}

export interface PricePlan {
  /** PUT body: base_price, plus variants when the item has options. Null when nothing changes. */
  body: { base_price: number; variants?: { id: string; name: string; price: number }[] } | null;
  before: number;
  after: number;
}

/**
 * New counter price for one item. Items with options (Half / Full) move every option:
 * "set" moves the cheapest option to the value and keeps the others' extra cost; % and ₹ apply to each option.
 */
export function planPrice(p: Pick<Product, 'base_price' | 'variants'>, op: PriceOp): PricePlan {
  if (!p.variants.length) {
    const after = applyOne(p.base_price, op);
    return { before: p.base_price, after, body: after === round2(p.base_price) ? null : { base_price: after } };
  }
  const low = Math.min(...p.variants.map((v) => v.price));
  const variants = p.variants.map((v) => ({
    id: v.id,
    name: v.name,
    price: op.mode === 'set' ? Math.min(MAX_PRICE, Math.max(0, round2(op.value + (v.price - low)))) : applyOne(v.price, op),
  }));
  const after = Math.min(...variants.map((v) => v.price));
  const changed = variants.some((v, i) => v.price !== round2(p.variants[i].price));
  return { before: low, after, body: changed ? { base_price: after, variants } : null };
}

/** Validates the price form; returns the op or an error message. */
export function parsePriceOp(mode: PriceOp['mode'], text: string, roundToRupee: boolean): { op: PriceOp } | { error: string } {
  const t = text.trim().replace(/,/g, '');
  if (!t || t === '-' || t === '.') return { error: mode === 'set' ? 'Enter the new price.' : 'Enter how much to change.' };
  const n = Number(t);
  if (!Number.isFinite(n)) return { error: 'Enter a number.' };
  if (mode === 'set') {
    if (n < 0) return { error: 'Price can’t be negative.' };
    if (n > MAX_PRICE) return { error: 'Price is too high.' };
    return { op: { mode, value: round2(n) } };
  }
  if (mode === 'percent') {
    if (n === 0) return { error: 'Use a number other than 0.' };
    if (n < -90 || n > 300) return { error: 'Use -90 to 300.' };
    return { op: { mode, value: n, roundToRupee } };
  }
  if (n === 0) return { error: 'Use a number other than 0.' };
  if (Math.abs(n) > MAX_PRICE) return { error: 'That is too much.' };
  return { op: { mode, value: round2(n) } };
}

// ---------------------------------------------------------------------------------------------------------------
// POST /catalog/products/bulk
// ---------------------------------------------------------------------------------------------------------------

/** The bulk endpoint's price action and rounding for a price op. */
export function bulkPriceAction(op: PriceOp): { action: 'price_set' | 'price_pct' | 'price_add'; value: number; round_to_rupee: boolean } {
  if (op.mode === 'set') return { action: 'price_set', value: op.value, round_to_rupee: false };
  if (op.mode === 'amount') return { action: 'price_add', value: op.value, round_to_rupee: false };
  return { action: 'price_pct', value: op.value, round_to_rupee: op.roundToRupee };
}

/**
 * Can the bulk endpoint make exactly the change the preview shows? Yes for every item: the server moves options the
 * same way (set → cheapest option at the value, others keep their extra cost; ₹ and % → every option). Kept as a
 * function so a future price rule that the server can't express falls back to one request per item.
 */
export function bulkCoversPrice(_p: Pick<Product, 'variants'>, _op: PriceOp): boolean {
  return true;
}

/** Split ids into request-sized chunks (the server takes up to 2,000; smaller chunks show progress and can stop). */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Running many requests
// ---------------------------------------------------------------------------------------------------------------

export interface PoolResult<T, R> {
  ok: { item: T; result: R }[];
  failed: { item: T; error: string }[];
}

/**
 * Runs `worker` for every item, `concurrency` at a time (fast on a big menu without flooding a slow connection).
 * Never throws: failures are collected with their message. `onProgress(done, total)` after each item.
 */
export async function runPool<T, R>(
  items: readonly T[],
  worker: (item: T) => Promise<R>,
  opts: { concurrency?: number; onProgress?: (done: number, total: number) => void; errorText?: (e: unknown) => string; signal?: { cancelled: boolean } } = {},
): Promise<PoolResult<T, R>> {
  const { concurrency = 4, onProgress, errorText = (e) => (e instanceof Error ? e.message : String(e)), signal } = opts;
  const queue = [...items];
  const result: PoolResult<T, R> = { ok: [], failed: [] };
  let done = 0;
  const run = async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
      if (signal?.cancelled) {
        result.failed.push({ item, error: 'Stopped' });
      } else {
        try {
          result.ok.push({ item, result: await worker(item) });
        } catch (e) {
          result.failed.push({ item, error: errorText(e) });
        }
      }
      done += 1;
      onProgress?.(done, items.length);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, run));
  return result;
}

/** "38 updated · 2 failed" */
export function resultLine(ok: number, failed: number, verb = 'updated'): string {
  if (!failed) return `${ok} ${verb}`;
  if (!ok) return `${failed} failed`;
  return `${ok} ${verb} · ${failed} failed`;
}
