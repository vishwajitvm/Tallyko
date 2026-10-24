/// <reference types="jest" />
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
import type { TableBill, TableInfo } from '@/api/types';
import {
  KITCHEN_AGE, ONLINE_AGE, TABLE_AGE, ORDER_STATUS_FILTERS, ageTone, bumpTarget, datePresetRange, floorAges, formatAge, freshIds, initials, kindCounts, matchesTableFilter,
  mergeFirstPage, minutesBetween, nextItemStep, paymentPillStatus, prevItemStep, pruneMarks, sectionCounts, summarizeTable, tableFilterCounts,
  ticketKind, ticketStatusFrom,
} from '../floorLogic';

const NOW = Date.parse('2026-10-24T12:00:00Z');
const minsAgo = (m: number) => new Date(NOW - m * 60000).toISOString();

function bill(over: Partial<TableBill> & { payment_claim?: unknown } = {}): TableBill {
  return {
    id: over.id ?? 'b1', code: 'A1', bill_label: null, total_amount: 500, status: 'open', payment_status: 'unpaid', guests: 2,
    customer_name: null, waiter_id: null, created_at: minsAgo(10), kitchen: {}, ...over,
  } as TableBill;
}
function table(id: string, bills: TableBill[] = [], over: Partial<TableInfo> = {}): TableInfo {
  return { id, table_number: id, section: null, capacity: 4, is_active: true, status: bills.length ? 'occupied' : 'free', open_bills: bills, ...over };
}

describe('age escalation', () => {
  it('turns tables amber after 45 min and red after 75 min', () => {
    expect(ageTone(44, TABLE_AGE)).toBe('ok');
    expect(ageTone(45, TABLE_AGE)).toBe('warn');
    expect(ageTone(74, TABLE_AGE)).toBe('warn');
    expect(ageTone(75, TABLE_AGE)).toBe('late');
  });
  it('escalates online orders after 3 minutes and kitchen tickets after 10', () => {
    expect(ageTone(2, ONLINE_AGE)).toBe('ok');
    expect(ageTone(3, ONLINE_AGE)).toBe('warn');
    expect(ageTone(6, ONLINE_AGE)).toBe('late');
    expect(ageTone(9, KITCHEN_AGE)).toBe('ok');
    expect(ageTone(10, KITCHEN_AGE)).toBe('warn');
    expect(ageTone(20, KITCHEN_AGE)).toBe('late');
  });
  it('formats running time for compact tiles', () => {
    expect(formatAge(0)).toBe('Now');
    expect(formatAge(42)).toBe('42 min');
    expect(formatAge(65)).toBe('1 h 05');
    expect(formatAge(26 * 60)).toBe('26 h');
  });
  it('counts whole minutes and never goes negative', () => {
    expect(minutesBetween(minsAgo(42.6), NOW)).toBe(42);
    expect(minutesBetween(new Date(NOW + 60000).toISOString(), NOW)).toBe(0);
    expect(minutesBetween(null, NOW)).toBe(0);
    expect(minutesBetween('not a date', NOW)).toBe(0);
  });
});

describe('waiter initials', () => {
  it('takes the first and last name', () => {
    expect(initials('Anil Kumar Sharma')).toBe('AS');
    expect(initials('ravi')).toBe('R');
    expect(initials('  ')).toBe('');
    expect(initials(null)).toBe('');
  });
});

describe('table summary and filters', () => {
  it('sums bills, guests and kitchen lines and times from the oldest bill', () => {
    const s = summarizeTable(table('T1', [
      bill({ id: 'a', created_at: minsAgo(50), guests: 2, kitchen: { ready: 2, preparing: 1 }, waiter_id: 'w1' }),
      bill({ id: 'b', created_at: minsAgo(5), guests: 3, total_amount: 250, kitchen: { pending: 2 } }),
    ]), NOW);
    expect(s.total).toBe(750);
    expect(s.guests).toBe(5);
    expect(s.ready).toBe(2);
    expect(s.cooking).toBe(3);
    expect(s.minutes).toBe(50);
    expect(s.state).toBe('ready');
    expect(s.waiterId).toBe('w1');
  });

  it('names the bill waiter from GET /tables, ahead of the waiter assigned to the table', () => {
    const t = table('T2', [bill({ waiter_id: 'w1', waiter_name: 'Anil Kumar' })], { assigned_staff_id: 'w2', assigned_staff_name: 'Ravi' });
    expect(summarizeTable(t, NOW)).toMatchObject({ waiterId: 'w1', waiterName: 'Anil Kumar' });
    expect(summarizeTable(table('T3', [bill()]), NOW).waiterName).toBeNull();
  });

  it('marks waiting payment for a UPI claim, part payment, or everything served', () => {
    expect(summarizeTable(table('A', [bill({ payment_claim: { method: 'UPI', amount: 500 } })]), NOW).state).toBe('payment');
    expect(summarizeTable(table('B', [bill({ payment_status: 'partial' })]), NOW).state).toBe('payment');
    expect(summarizeTable(table('C', [bill({ kitchen: { served: 3 } })]), NOW).state).toBe('payment');
    expect(summarizeTable(table('D', [bill({ kitchen: { served: 3, pending: 1 } })]), NOW).state).toBe('occupied');
    expect(summarizeTable(table('E', [bill({ id: 'x' })]), NOW, new Set(['x'])).upiToConfirm).toBe(true);
  });

  it('shows a new QR order before anything else', () => {
    expect(summarizeTable(table('Q', [bill({ status: 'placed', kitchen: { ready: 1 } })]), NOW).state).toBe('new');
  });

  it('falls back to the assigned waiter on the table', () => {
    expect(summarizeTable(table('F', [], { assigned_staff_id: 'w9' }), NOW).waiterId).toBe('w9');
    expect(summarizeTable(table('F', [], { assigned_staff_id: 'w9', assigned_staff_name: 'Ravi' }), NOW).waiterName).toBe('Ravi');
    expect(summarizeTable(table('F', []), NOW).state).toBe('free');
  });

  it('counts every filter chip', () => {
    const tables = [
      table('1'), table('2'),
      table('3', [bill({ kitchen: { ready: 1 } })]),
      table('4', [bill({ payment_claim: { method: 'UPI', amount: 1 } })]),
      table('5', [bill({ kitchen: { preparing: 2 } })]),
    ].map((t) => summarizeTable(t, NOW));
    expect(tableFilterCounts(tables)).toEqual({ all: 5, free: 2, occupied: 3, ready: 1, payment: 1 });
    expect(tables.filter((s) => matchesTableFilter(s, 'free')).length).toBe(2);
  });

  it('groups sections in floor order with busy counts; unnamed tables go under "Tables"', () => {
    const list = [{ section: 'Garden' }, { section: 'Garden' }, { section: null }, { section: 'AC Hall' }];
    expect(sectionCounts(list, (i) => i === 1 || i === 3)).toEqual([
      { name: 'Garden', total: 2, busy: 1 }, { name: 'Tables', total: 1, busy: 0 }, { name: 'AC Hall', total: 1, busy: 1 },
    ]);
  });
});

describe('kitchen', () => {
  it('files tickets under delivery apps first, then the order type', () => {
    expect(ticketKind({ channel: 'SWIGGY', type: 'DELIVERY' })).toBe('SWIGGY');
    expect(ticketKind({ channel: 'ZOMATO', type: 'TAKEAWAY' })).toBe('ZOMATO');
    expect(ticketKind({ channel: 'ONLINE', type: 'DELIVERY' })).toBe('DELIVERY');
    expect(ticketKind({ channel: 'QR', type: 'DINE_IN' })).toBe('DINE_IN');
    expect(ticketKind({ channel: 'POS', type: 'RETAIL_WALKIN' })).toBe('TAKEAWAY');
    expect(kindCounts([{ channel: 'SWIGGY', type: 'DELIVERY' }, { channel: 'POS', type: 'DINE_IN' }, { channel: 'POS', type: 'DINE_IN' }]))
      .toEqual({ all: 3, DINE_IN: 2, TAKEAWAY: 0, DELIVERY: 0, SWIGGY: 1, ZOMATO: 0 });
  });

  it('moves items one step with a tap and back with a long-press', () => {
    expect(nextItemStep('pending')).toBe('preparing');
    expect(nextItemStep('ready')).toBe('served');
    expect(nextItemStep('served')).toBeNull();
    expect(prevItemStep('preparing')).toBe('pending');
    expect(prevItemStep('pending')).toBeNull();
  });

  it('bumps a whole ticket through the columns', () => {
    expect(bumpTarget('pending')).toBe('preparing');
    expect(bumpTarget('preparing')).toBe('ready');
    expect(bumpTarget('ready')).toBe('served');
    expect(bumpTarget('served')).toBeNull();
  });

  it('derives the ticket status from its least advanced live line', () => {
    expect(ticketStatusFrom([{ status: 'ready', is_void: false }, { status: 'preparing', is_void: false }], 'pending')).toBe('preparing');
    expect(ticketStatusFrom([{ status: 'ready', is_void: false }, { status: 'pending', is_void: true }], 'pending')).toBe('ready');
    expect(ticketStatusFrom([{ status: 'pending', is_void: true }], 'pending')).toBe('cancelled');
    expect(ticketStatusFrom([], 'ready')).toBe('ready');
  });
});

describe('new arrivals', () => {
  it('never treats the first load as new', () => {
    expect(freshIds(null, ['a', 'b'])).toEqual([]);
    expect(freshIds(new Set(['a']), ['a', 'b', 'c'])).toEqual(['b', 'c']);
  });
  it('drops highlights after their time', () => {
    expect(pruneMarks({ a: NOW - 31_000, b: NOW - 5_000 }, NOW, 30_000)).toEqual({ b: NOW - 5_000 });
  });
});

describe('orders list', () => {
  it('keeps scrolled rows when the first page refreshes', () => {
    const current = [{ id: '3', v: 1 }, { id: '2', v: 1 }, { id: '1', v: 1 }];
    expect(mergeFirstPage(current, [{ id: '4', v: 1 }, { id: '3', v: 2 }])).toEqual([
      { id: '4', v: 1 }, { id: '3', v: 2 }, { id: '2', v: 1 }, { id: '1', v: 1 },
    ]);
    expect(mergeFirstPage([], [{ id: '1' }])).toEqual([{ id: '1' }]);
  });

  it('builds date ranges for the presets', () => {
    const now = new Date(2026, 9, 24, 15, 30);
    const today = datePresetRange('today', now);
    expect(today.from).toMatch(/^2026-10-24T00:00:00/);
    expect(today.to).toMatch(/^2026-10-25T00:00:00/);
    expect(datePresetRange('yesterday', now).from).toMatch(/^2026-10-23T00:00:00/);
    expect(datePresetRange('week', now).from).toMatch(/^2026-10-18T00:00:00/);
    expect(datePresetRange('month', now).from).toMatch(/^2026-09-25T00:00:00/);
    expect(datePresetRange('any', now)).toEqual({});
  });

  it('shows a UPI claim before the payment status', () => {
    expect(paymentPillStatus({ status: 'open', payment_status: 'unpaid', payment_claim: { amount: 1 } })).toBe('claim');
    expect(paymentPillStatus({ status: 'completed', payment_status: 'paid' })).toBe('paid');
    expect(paymentPillStatus({ status: 'cancelled', payment_status: 'unpaid' })).toBeNull();
  });
});

describe('floor alert times (settings ops_thresholds)', () => {
  it('uses the defaults when nothing is set', () => {
    expect(floorAges(null)).toEqual({ table: TABLE_AGE, kitchen: KITCHEN_AGE, online: ONLINE_AGE });
  });

  it('uses the business times, online red at twice the wait', () => {
    const a = floorAges({ table_amber_min: 30, table_red_min: 60, kitchen_amber_min: 8, kitchen_red_min: 15, online_wait_min: 5 });
    expect(a.table).toEqual({ warn: 30, late: 60 });
    expect(a.kitchen).toEqual({ warn: 8, late: 15 });
    expect(a.online).toEqual({ warn: 5, late: 10 });
    expect(ageTone(31, a.table)).toBe('warn');
  });

  it('falls back per pair for missing or inconsistent values', () => {
    const a = floorAges({ table_amber_min: 90, table_red_min: 60, kitchen_amber_min: 12, online_wait_min: 0 });
    expect(a.table).toEqual(TABLE_AGE); // red before amber
    expect(a.kitchen).toEqual({ warn: 12, late: 20 });
    expect(a.online).toEqual(ONLINE_AGE);
  });
});

describe('order status chips', () => {
  it('offers Merged only as an optional chip', () => {
    expect(ORDER_STATUS_FILTERS.map((f) => f.key)).toEqual(['all', 'active', 'placed', 'completed', 'cancelled', 'merged']);
    expect(ORDER_STATUS_FILTERS.find((f) => f.key === 'merged')?.optional).toBe(true);
  });
});
