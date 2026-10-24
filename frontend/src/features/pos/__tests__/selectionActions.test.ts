/// <reference types="jest" />
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
import type { OrderItem } from '@/api/types';
import { describeSelection } from '../runningBill';
import { selectionActions } from '../RunningBill';

const item = (id: string, over: Partial<OrderItem> = {}): OrderItem => ({
  id, product_id: `p-${id}`, variant_id: null, name: id, variant_name: null, quantity: 1, unit_price: 100, tax_rate: 5, tax_amount: 5,
  line_total: 100, notes: null, sent_to_kitchen: true, kot_id: 'k1', kitchen_status: 'pending', ...over,
});

const all = { status: true, create: true, voidSent: true, comp: true };
const items = [
  item('roti', { quantity: 4, kitchen_status: 'ready' }),
  item('dal', { kitchen_status: 'preparing' }),
  item('water', { kitchen_status: null, kot_id: null, sent_to_kitchen: false }),
];

describe('selection bar actions', () => {
  it('puts the next kitchen step, Cancel and Repeat one tap away', () => {
    const sel = describeSelection(items, new Set(['roti']));
    const { main, more } = selectionActions({ sel, locked: false, online: true, busy: false, perms: all });
    expect(main.map((a) => a.key)).toEqual(['served', 'void', 'repeat']);
    expect(main[0]!.variant).toBe('primary');
    expect(more.map((a) => a.key)).toEqual(['preparing', 'ready', 'comp', 'move']);
    expect(more.find((a) => a.key === 'ready')!.disabled).toBe(true); // already ready
  });

  it('moves a mixed selection to the step after its least advanced item', () => {
    const sel = describeSelection(items, new Set(['roti', 'dal']));
    expect(selectionActions({ sel, locked: false, online: true, busy: false, perms: all }).main[0]!.key).toBe('ready');
  });

  it('shows no kitchen step for items that skip the kitchen', () => {
    const sel = describeSelection(items, new Set(['water']));
    const { main, more } = selectionActions({ sel, locked: false, online: true, busy: false, perms: all });
    expect(main.map((a) => a.key)).toEqual(['void', 'repeat']);
    expect(more.map((a) => a.key)).toEqual(['comp', 'move']);
  });

  it('explains why actions are off: offline, paid bills, kitchen items for non-managers', () => {
    const sel = describeSelection(items, new Set(['roti']));
    const offline = selectionActions({ sel, locked: false, online: false, busy: false, perms: all });
    expect(offline.main.every((a) => a.disabled && a.disabledReason === 'Needs internet')).toBe(true);
    const locked = selectionActions({ sel, locked: true, online: true, busy: false, perms: all });
    expect(locked.main.find((a) => a.key === 'void')!.disabledReason).toMatch(/payment/);
    expect(locked.main.find((a) => a.key === 'repeat')!.disabled).toBe(false);
    const waiter = selectionActions({ sel, locked: false, online: true, busy: false, perms: { ...all, voidSent: false } });
    expect(waiter.main.find((a) => a.key === 'void')!.disabledReason).toMatch(/manager/);
  });

  it('only offers what the role allows', () => {
    const sel = describeSelection(items, new Set(['roti']));
    const { main, more } = selectionActions({ sel, locked: false, online: true, busy: false, perms: { status: true, create: false, voidSent: false, comp: false } });
    expect(main.map((a) => a.key)).toEqual(['served']);
    expect(more.map((a) => a.key)).toEqual(['preparing', 'ready']);
  });
});
