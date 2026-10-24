/// <reference types="jest" />
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
import type { Order, OrderItem, Product } from '@/api/types';
import { availableOn, unitPriceFor } from '@/lib/billing';
import { EMPTY_DRAFT, type CartLine, type Draft } from '../cart';
import { buildCreatePayload, priceDraft, validateDraft } from '../totals';

const product = (over: Partial<Product> = {}): Product => ({
  id: 'p1', name: 'Butter Chicken', description: null, base_price: 250, cost_price: null, tax_rate: 5, category_id: null, brand_id: null,
  barcode: null, sku: null, unit: 'pc', is_veg: false, is_active: true, print_to_kitchen: true, track_stock: false, low_stock_threshold: null,
  sort_order: 0, variants: [{ id: 'half', name: 'Half', price: 250 }, { id: 'full', name: 'Full', price: 400 }], ...over,
});

const line = (over: Partial<CartLine> = {}): CartLine => ({
  id: 'l1', productId: 'p1', variantId: null, name: 'Butter Chicken', variantName: null, price: 250, taxRate: 5, quantity: 2, notes: null, ...over,
});

const settings = { prices_include_tax: false, default_tax_rate: 5 } as any;
const tax = { registration: 'regular', default_tax_class_id: null, classes: [] } as any;

describe('per-channel prices (backend channel_menu.unit_price)', () => {
  const p = product({ channel_prices: { SWIGGY: { price: 289 }, ZOMATO: { available: false } } });

  it('uses the item price set for the channel', () => {
    expect(unitPriceFor(p, null, 10, 'SWIGGY')).toBe(289);
  });
  it('keeps an option\'s extra cost on top of the channel price', () => {
    // Full is 150 more than the base price on the counter, so 289 + 150 on Swiggy
    expect(unitPriceFor(p, 'full', 10, 'SWIGGY')).toBe(439);
    expect(unitPriceFor(p, 'half', 10, 'SWIGGY')).toBe(289);
  });
  it('falls back to the channel mark-up without an item price, rounded to the rupee', () => {
    expect(unitPriceFor(p, null, 10, 'ZOMATO')).toBe(275);
    expect(unitPriceFor(p, 'full', 10, 'ONDC')).toBe(440);
    expect(unitPriceFor(p, null, 0, 'POS')).toBe(250);
    expect(unitPriceFor(p, null)).toBe(250);
    // ₹249 + 8% = 268.92 → ₹269 (server: ROUND_HALF_UP on base + option)
    expect(unitPriceFor(product({ base_price: 249, variants: [] }), null, 8, 'ZOMATO')).toBe(269);
    expect(unitPriceFor(product({ base_price: 250, variants: [] }), null, 5, 'ZOMATO')).toBe(263); // 262.5 → 263
    expect(unitPriceFor(product({ base_price: 49.5, variants: [] }), null, 0, 'POS')).toBe(49.5); // no mark-up: paise kept
  });
  it('hides items switched off for a channel', () => {
    expect(availableOn(p, 'ZOMATO')).toBe(false);
    expect(availableOn(p, 'SWIGGY')).toBe(true);
    expect(availableOn(p, 'POS')).toBe(true);
    expect(availableOn({ ...p, is_active: false }, 'SWIGGY')).toBe(false);
  });
});

describe('price preview on a channel', () => {
  const p = product({ channel_prices: { SWIGGY: { price: 289 }, ZOMATO: { available: false } } });
  const byId = new Map([[p.id, p]]);

  it('prices Swiggy bills with the Swiggy price', () => {
    const draft: Draft = { ...EMPTY_DRAFT, channel: 'SWIGGY', orderType: 'DELIVERY', lines: [line()] };
    const priced = priceDraft(draft, byId, settings, 15, { tax });
    expect(priced.lines[0]!.unitPrice).toBe(289);
    expect(priced.preview.subtotal).toBe(578);
    expect(priced.missing).toHaveLength(0);
  });

  it('blocks items that are not on the channel\'s menu', () => {
    const draft: Draft = { ...EMPTY_DRAFT, channel: 'ZOMATO', orderType: 'DELIVERY', lines: [line()] };
    const priced = priceDraft(draft, byId, settings, 0, { tax });
    expect(priced.lines[0]!.unavailable).toBe(true);
    expect(validateDraft(draft, priced, { requireLines: true })).toMatch(/isn't on the Zomato menu/);
  });
});

describe('running bill totals', () => {
  const item = (over: Partial<OrderItem>): OrderItem => ({
    id: 'i', product_id: 'p1', variant_id: null, name: 'Roti', variant_name: null, quantity: 1, unit_price: 20, tax_rate: 5, tax_amount: 1,
    line_total: 20, notes: null, sent_to_kitchen: true, kitchen_status: 'pending', ...over,
  });
  const order = (items: OrderItem[]): Order => ({
    id: 'o1', code: 'O1', invoice_no: null, token_no: 1, type: 'DINE_IN', channel: 'POS', external_order_id: null, status: 'open', payment_status: 'unpaid',
    table_id: 't1', customer_id: null, brand_id: null, customer_name: null, customer_phone: null, delivery_address: null, notes: null, subtotal: 0,
    discount_amount: 0, tax_amount: 0, round_off: 0, total_amount: 0, paid_amount: 0, balance_due: 0, commission_amount: 0, loyalty_points_earned: 0,
    loyalty_points_redeemed: 0, cancel_reason: null, created_at: '2026-10-24T10:00:00Z', completed_at: null, items, payments: [], tax_breakup: [],
  });

  it('never charges cancelled lines and counts on-the-house lines at 0', () => {
    const draft: Draft = {
      ...EMPTY_DRAFT, orderType: 'DINE_IN', resume: order([
        item({ id: 'a', quantity: 4 }),
        item({ id: 'b', quantity: 1, kitchen_status: 'void', is_void: true, void_reason: 'Changed mind', line_total: 0, tax_amount: 0 }),
        item({ id: 'c', quantity: 1, unit_price: 0, line_total: 0, comp_reason: 'Regular', comp_value: 20 }),
      ]),
    };
    const priced = priceDraft(draft, new Map(), settings, 0, { tax });
    expect(priced.preview.subtotal).toBe(80);
    expect(priced.preview.total).toBe(84);
    expect(priced.itemCount).toBe(5);
    expect(priced.existing).toHaveLength(3);
  });
});

describe('separate bills on a table', () => {
  it('asks the server for another bill on the table, with its name and guests', () => {
    const draft: Draft = { ...EMPTY_DRAFT, orderType: 'DINE_IN', tableId: 't1', tableLabel: '7', newBill: true, billLabel: ' Rahul ', guests: 2, lines: [line()] };
    const body = buildCreatePayload(draft, { id: 'x', createdAt: '2026-10-24T10:00:00Z', sendToKitchen: true });
    expect(body).toMatchObject({ table_id: 't1', new_bill: true, bill_label: 'Rahul', guests: 2 });
  });
  it('leaves them out for offline bills and takeaway', () => {
    const draft: Draft = { ...EMPTY_DRAFT, orderType: 'DINE_IN', tableId: 't1', newBill: true, billLabel: 'Rahul', lines: [line()] };
    expect(buildCreatePayload(draft, { id: 'x', createdAt: 'now', sendToKitchen: true, offline: true })).not.toHaveProperty('new_bill');
    expect(buildCreatePayload({ ...draft, orderType: 'TAKEAWAY' }, { id: 'x', createdAt: 'now', sendToKitchen: true })).not.toHaveProperty('new_bill');
  });
});
