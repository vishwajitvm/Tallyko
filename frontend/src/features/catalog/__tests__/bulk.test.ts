import type { Product } from '@/api/types';
import {
  bulkCoversPrice, bulkPriceAction, chunk, filterMenu, menuCounts, parsePriceOp, planPrice, resultLine, runPool, sortMenu, withChannelAvailability,
} from '../bulk';
import { applyStockChange, clampQty, createScanBuffer, filterStock, stockCounts } from '../inventory/stockLogic';
import type { StockRow } from '@/api/types';

const product = (over: Partial<Product> = {}): Product => ({
  id: 'p1', name: 'Paneer Tikka', description: null, base_price: 200, cost_price: null, tax_rate: null, category_id: 'c1',
  brand_id: null, barcode: null, sku: null, unit: 'pcs', is_veg: true, is_active: true, print_to_kitchen: true, track_stock: false,
  low_stock_threshold: null, sort_order: 0, variants: [], tax_class_id: null, channel_prices: {}, ...over,
});

const cats = new Set(['c1', 'c2']);
const menu = [
  product({ id: 'a', name: 'Paneer Tikka', category_id: 'c1', sku: 'PT-1' }),
  product({ id: 'b', name: 'Dal Makhani', category_id: 'c2', barcode: '8901234567890' }),
  product({ id: 'c', name: 'Old Special', category_id: 'c1', is_active: false }),
  product({ id: 'd', name: 'Mystery', category_id: 'gone' }),
  product({ id: 'e', name: 'Swiggy-hidden Roll', category_id: 'c2', channel_prices: { SWIGGY: { available: false } } }),
];

describe('menu filter and counts', () => {
  it('filters by category, uncategorised, removed and search (name, SKU, barcode)', () => {
    const q = { query: '', channel: null, categoryIds: cats };
    expect(filterMenu(menu, { ...q, filter: 'all' }).map((p) => p.id)).toEqual(['a', 'b', 'd', 'e']);
    expect(filterMenu(menu, { ...q, filter: 'c1' }).map((p) => p.id)).toEqual(['a']);
    expect(filterMenu(menu, { ...q, filter: 'none' }).map((p) => p.id)).toEqual(['d']);
    expect(filterMenu(menu, { ...q, filter: 'removed' }).map((p) => p.id)).toEqual(['c']);
    expect(filterMenu(menu, { ...q, filter: 'all', query: 'pt-1' }).map((p) => p.id)).toEqual(['a']);
    expect(filterMenu(menu, { ...q, filter: 'all', query: '890123' }).map((p) => p.id)).toEqual(['b']);
  });

  it('a channel view hides items that are off that channel', () => {
    expect(filterMenu(menu, { filter: 'all', query: '', channel: 'SWIGGY', categoryIds: cats }).map((p) => p.id)).toEqual(['a', 'b', 'd']);
  });

  it('counts chips for the current search and channel', () => {
    expect(menuCounts(menu, { query: '', channel: null, categoryIds: cats })).toEqual({ all: 4, none: 1, removed: 1, byCategory: { c1: 1, c2: 2 } });
    expect(menuCounts(menu, { query: 'roll', channel: 'SWIGGY', categoryIds: cats }).all).toBe(0);
  });

  it('sorts in menu order by default and by a column with menu order as tie-break', () => {
    const rank = new Map([['c2', 0], ['c1', 1]]);
    expect(sortMenu(menu.slice(0, 2), null, rank).map((p) => p.id)).toEqual(['b', 'a']);
    const priced = [product({ id: 'x', base_price: 50 }), product({ id: 'y', base_price: 300 })];
    expect(sortMenu(priced, { key: 'price', dir: 'desc' }, rank).map((p) => p.id)).toEqual(['y', 'x']);
    const stock = new Map([['x', 5]]);
    expect(sortMenu(priced, { key: 'stock', dir: 'desc' }, rank, stock).map((p) => p.id)).toEqual(['x', 'y']);
  });
});

describe('bulk prices', () => {
  it('validates the form', () => {
    expect(parsePriceOp('set', '', true)).toEqual({ error: 'Enter the new price.' });
    expect(parsePriceOp('percent', '0', true)).toEqual({ error: 'Use a number other than 0.' });
    expect(parsePriceOp('percent', '500', true)).toEqual({ error: 'Use -90 to 300.' });
    expect(parsePriceOp('set', '-5', true)).toEqual({ error: 'Price can’t be negative.' });
    expect(parsePriceOp('amount', '-10', true)).toEqual({ op: { mode: 'amount', value: -10 } });
  });

  it('changes a plain item and skips unchanged ones', () => {
    expect(planPrice(product({ base_price: 249 }), { mode: 'percent', value: 10, roundToRupee: true })).toEqual({ before: 249, after: 274, body: { base_price: 274 } });
    expect(planPrice(product({ base_price: 249 }), { mode: 'percent', value: 10, roundToRupee: false }).after).toBe(273.9);
    expect(planPrice(product({ base_price: 100 }), { mode: 'set', value: 100 }).body).toBeNull();
    expect(planPrice(product({ base_price: 20 }), { mode: 'amount', value: -50 }).after).toBe(0);
  });

  it('moves every option of an item with options, keeping their extra cost on "set"', () => {
    const p = product({ base_price: 150, variants: [{ id: 'h', name: 'Half', price: 150 }, { id: 'f', name: 'Full', price: 250 }] });
    expect(planPrice(p, { mode: 'set', value: 180 }).body).toEqual({
      base_price: 180, variants: [{ id: 'h', name: 'Half', price: 180 }, { id: 'f', name: 'Full', price: 280 }],
    });
    expect(planPrice(p, { mode: 'amount', value: 10 }).body?.variants?.map((v) => v.price)).toEqual([160, 260]);
  });
});

describe('show / hide on a channel', () => {
  it('hides and shows, keeping an own price, and reports no-ops as null', () => {
    expect(withChannelAvailability({ SWIGGY: { price: 289 } }, 'swiggy', false)).toEqual({ SWIGGY: { price: 289, available: false } });
    expect(withChannelAvailability({ SWIGGY: { price: 289, available: false } }, 'SWIGGY', true)).toEqual({ SWIGGY: { price: 289 } });
    expect(withChannelAvailability({ ZOMATO: { available: false } }, 'ZOMATO', true)).toEqual({});
    expect(withChannelAvailability({}, 'POS', true)).toBeNull();
  });
});

describe('runPool', () => {
  it('runs everything with limited concurrency and collects failures', async () => {
    let running = 0;
    let peak = 0;
    const progress: number[] = [];
    const r = await runPool([1, 2, 3, 4, 5, 6], async (n) => {
      running += 1; peak = Math.max(peak, running);
      await new Promise((res) => setTimeout(res, 2));
      running -= 1;
      if (n % 3 === 0) throw new Error(`bad ${n}`);
      return n * 10;
    }, { concurrency: 2, onProgress: (d) => progress.push(d) });
    expect(peak).toBeLessThanOrEqual(2);
    expect(r.ok.map((x) => x.result).sort((a, b) => a - b)).toEqual([10, 20, 40, 50]);
    expect(r.failed.map((f) => f.error).sort()).toEqual(['bad 3', 'bad 6']);
    expect(progress[progress.length - 1]).toBe(6);
  });

  it('stops early when cancelled', async () => {
    const signal = { cancelled: true };
    const r = await runPool([1, 2], async (n) => n, { signal });
    expect(r.ok).toEqual([]);
    expect(r.failed.map((f) => f.error)).toEqual(['Stopped', 'Stopped']);
  });

  it('summarises results', () => {
    expect(resultLine(3, 0)).toBe('3 updated');
    expect(resultLine(3, 1, 'removed')).toBe('3 removed · 1 failed');
    expect(resultLine(0, 2)).toBe('2 failed');
  });
});

const row = (over: Partial<StockRow> = {}): StockRow => ({
  id: 's1', name: 'Amul Butter', category_id: null, barcode: '8901', unit: 'pcs', stock: 12, low_stock_threshold: 10, is_low: false,
  cost_price: 50, stock_value: 600, ...over,
});

describe('inventory', () => {
  const rows = [row({ id: 'a', name: 'Milk', stock: 0, is_low: true }), row({ id: 'b', name: 'Bread', stock: 4, is_low: true }), row({ id: 'c', name: 'Atta' })];

  it('counts and filters low / out of stock, lowest first', () => {
    expect(stockCounts(rows)).toEqual({ all: 3, low: 2, out: 1 });
    expect(filterStock(rows, 'low', '').map((r) => r.id)).toEqual(['a', 'b']);
    expect(filterStock(rows, 'out', '').map((r) => r.id)).toEqual(['a']);
    expect(filterStock(rows, 'all', '').map((r) => r.id)).toEqual(['b', 'a', 'c']);
    expect(filterStock(rows, 'all', 'atta').map((r) => r.id)).toEqual(['c']);
  });

  it('applies a quick change optimistically', () => {
    expect(applyStockChange(row(), -3)).toMatchObject({ stock: 9, is_low: true, stock_value: 450 });
    expect(applyStockChange(row({ stock: 1 }), -2)).toMatchObject({ stock: -1, stock_value: 0 });
    expect(clampQty(0)).toBe(1);
    expect(clampQty(12000)).toBe(9999);
  });

  it('recognises a hardware scanner burst but not normal typing', () => {
    const feed = createScanBuffer();
    let t = 1000;
    let code: string | null = null;
    for (const k of '8901234567890') code = feed(k, (t += 8)) ?? code;
    expect(feed('Enter', (t += 8))).toBe('8901234567890');
    expect(code).toBeNull();
    const slow = createScanBuffer();
    for (const k of 'abcdef') slow(k, (t += 200));
    expect(slow('Enter', (t += 200))).toBeNull();
  });
});

describe('bulk endpoint mapping', () => {
  it('maps price ops to the bulk actions and rounding', () => {
    expect(bulkPriceAction({ mode: 'set', value: 149.5 })).toEqual({ action: 'price_set', value: 149.5, round_to_rupee: false });
    expect(bulkPriceAction({ mode: 'amount', value: -10 })).toEqual({ action: 'price_add', value: -10, round_to_rupee: false });
    expect(bulkPriceAction({ mode: 'percent', value: 5, roundToRupee: true })).toEqual({ action: 'price_pct', value: 5, round_to_rupee: true });
  });

  it('sends items with options one by one unless the change is a percentage', () => {
    const withOptions = product({ variants: [{ id: 'v1', name: 'Half', price: 120 }, { id: 'v2', name: 'Full', price: 200 }] });
    expect(bulkCoversPrice(product(), { mode: 'set', value: 10 })).toBe(true);
    expect(bulkCoversPrice(withOptions, { mode: 'percent', value: 5, roundToRupee: true })).toBe(true);
    expect(bulkCoversPrice(withOptions, { mode: 'set', value: 150 })).toBe(true);
    expect(bulkCoversPrice(withOptions, { mode: 'amount', value: 10 })).toBe(true);
  });

  it('chunks ids', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 250)).toEqual([]);
  });
});
