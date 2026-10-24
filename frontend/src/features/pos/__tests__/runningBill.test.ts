/// <reference types="jest" />
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
import type { OrderItem } from '@/api/types';
import {
  billName, describeSelection, itemsLocked, kitchenCounts, kitchenProgress, nextKitchenStatus, pruneSelection, selectableItems, toItemQty,
} from '../runningBill';

const item = (id: string, over: Partial<OrderItem> = {}): OrderItem => ({
  id, product_id: `p-${id}`, variant_id: null, name: id, variant_name: null, quantity: 1, unit_price: 100, tax_rate: 5, tax_amount: 5,
  line_total: 100, notes: null, sent_to_kitchen: true, kot_id: 'k1', kitchen_status: 'pending', ...over,
});

describe('selection on a running bill', () => {
  const items = [
    item('roti', { quantity: 4, kitchen_status: 'ready' }),
    item('dal', { kitchen_status: 'preparing' }),
    item('water', { kitchen_status: null, kot_id: null, sent_to_kitchen: false }),
    item('cancelled', { kitchen_status: 'void', is_void: true }),
    item('free', { unit_price: 0, line_total: 0, is_free: true, notes: 'Free — Combo' }),
    item('comp', { unit_price: 0, line_total: 0, comp_reason: 'Regular', comp_value: 100 }),
  ];

  it('never lets cancelled lines be ticked', () => {
    expect(selectableItems(items).map((i) => i.id)).not.toContain('cancelled');
    const sel = describeSelection(items, new Set(['cancelled', 'roti']));
    expect(sel.items.map((i) => i.id)).toEqual(['roti']);
  });

  it('works out what each action may touch', () => {
    const sel = describeSelection(items, new Set(['roti', 'water', 'free', 'comp']));
    expect(sel.kitchen.map((i) => i.id)).toEqual(['roti', 'free', 'comp']);
    expect(sel.voidable.map((i) => i.id)).toEqual(['roti', 'water', 'comp']);
    expect(sel.compable.map((i) => i.id)).toEqual(['roti', 'water']);
    expect(sel.anySent).toBe(true);
    expect(sel.quantity).toBe(7);
  });

  it('cancelling only unsent items needs no reason', () => {
    expect(describeSelection(items, new Set(['water'])).anySent).toBe(false);
  });

  it('drops ticks for lines that disappeared or were cancelled', () => {
    const after = items.map((i) => (i.id === 'dal' ? { ...i, kitchen_status: 'void' as const, is_void: true } : i));
    expect([...pruneSelection(after, new Set(['dal', 'roti', 'gone']))]).toEqual(['roti']);
  });
});

describe('kitchen progress', () => {
  it('moves a mixed selection one step past its least advanced line (2 ready, 2 cooking → ready)', () => {
    expect(nextKitchenStatus([{ kitchen_status: 'ready' }, { kitchen_status: 'ready' }, { kitchen_status: 'preparing' }, { kitchen_status: 'preparing' }])).toBe('ready');
    expect(nextKitchenStatus([{ kitchen_status: 'pending' }])).toBe('preparing');
    expect(nextKitchenStatus([{ kitchen_status: 'ready' }])).toBe('served');
    expect(nextKitchenStatus([{ kitchen_status: 'served' }])).toBeNull();
    expect(nextKitchenStatus([])).toBeNull();
  });

  it('counts live kitchen lines and highlights food waiting to be served', () => {
    const counts = kitchenCounts([item('a', { kitchen_status: 'ready' }), item('b', { kitchen_status: 'ready' }), item('c'),
      item('d', { kitchen_status: 'void', is_void: true }), item('e', { kitchen_status: null })]);
    expect(counts).toEqual({ ready: 2, pending: 1 });
    expect(kitchenProgress(counts)).toEqual({ label: '2 ready to serve', tone: 'success' });
    expect(kitchenProgress({ preparing: 1, pending: 2 })).toEqual({ label: '3 cooking', tone: 'info' });
    expect(kitchenProgress({ pending: 2 })?.label).toBe('2 waiting');
    expect(kitchenProgress({ served: 3 })?.label).toBe('All served');
    expect(kitchenProgress({})).toBeNull();
  });
});

describe('bills and quantities', () => {
  it('names bills by label, else by position', () => {
    expect(billName({ bill_label: 'Rahul' }, 1)).toBe('Rahul');
    expect(billName({ bill_label: null }, 1)).toBe('Bill 2');
    expect(billName({ bill_label: '  ' }, 0)).toBe('Bill 1');
  });

  it('sends a whole line without a quantity and part of a line with one', () => {
    const lines = [item('roti', { quantity: 4 }), item('dal', { quantity: 2 }), item('lassi', { quantity: 1 })];
    expect(toItemQty(lines, { roti: 1, dal: 2, lassi: 0 })).toEqual([{ item_id: 'roti', quantity: 1 }, { item_id: 'dal' }]);
    expect(toItemQty(lines, { roti: 9 })).toEqual([{ item_id: 'roti' }, { item_id: 'dal' }, { item_id: 'lassi' }]);
  });

  it('locks items once a payment is taken', () => {
    expect(itemsLocked({ paid_amount: 0, payments: [] })).toBe(false);
    expect(itemsLocked({ paid_amount: 100, payments: [{ id: 'x', method: 'CASH', amount: 100, reference: null }] })).toBe(true);
  });
});
