import type { OwnerWatch } from '@/api/owner';
import { filterByStaff, groupByDay, rankStaff, staffLoss, staffOptions, totalLoss } from '../watchUtils';
import { viewCount, watchRows } from '../watchRows';

const ANIL = 'a-1';
const RAVI = 'r-2';

const watch: OwnerWatch = {
  from: '2026-10-17T00:00:00Z',
  to: '2026-10-24T00:00:00Z',
  totals: {
    cancelled_bills: 1, cancelled_bills_value: 168, items_cancelled: 1, items_cancelled_value: 110, items_removed: 1,
    items_removed_value: 120, on_the_house: 1, on_the_house_value: 50, discounted_bills: 1, discount_value: 11, menu_changes: 1,
  },
  by_staff: [
    { staff_id: RAVI, name: 'Ravi Yadav', cancelled_bills: 0, cancelled_bills_value: 0, items_cancelled: 0, items_cancelled_value: 0,
      items_removed: 1, items_removed_value: 120, discounts: 0, discount_value: 0 },
    { staff_id: ANIL, name: 'Anil Kumar', cancelled_bills: 1, cancelled_bills_value: 168, items_cancelled: 1, items_cancelled_value: 110,
      items_removed: 0, items_removed_value: 0, discounts: 1, discount_value: 11 },
  ],
  cancelled_bills: [{ id: 'o1', bill: 'B1', total: 168, reason: 'Left', by: 'Anil Kumar', table_id: null, created_at: '', cancelled_at: '' }],
  items: [
    { order_id: 'o1', bill: 'B1', bill_status: 'cancelled', name: 'Jeera Rice', variant: null, quantity: 1, value: 120, after_kitchen: false,
      reason: null, by: 'Ravi Yadav', by_staff_id: RAVI, at: '2026-10-23T20:46:52Z' },
    { order_id: 'o1', bill: 'B1', bill_status: 'cancelled', name: 'Dal Makhani', variant: null, quantity: 1, value: 110, after_kitchen: true,
      reason: 'Changed mind', by: 'Anil Kumar', by_staff_id: ANIL, at: '2026-10-23T20:46:51Z' },
  ],
  on_the_house: [{ order_id: 'o2', bill: 'B2', name: 'Gulab Jamun', quantity: 1, value: 50, reason: 'Birthday' }],
  menu_changes: [{ product_id: 'p1', name: 'Jeera Rice', version: 2, change: 'Price ₹120 → ₹130', changed_by: 'Anil Kumar',
    changed_by_staff_id: ANIL, created_at: '2026-10-23T21:00:00Z' }],
  events: [
    { id: 'e1', action: 'order.comp', label: 'Gave items on the house', by: 'Anil Kumar', by_staff_id: ANIL, summary: null,
      details: { bill_comp_value: 50 }, at: '2026-10-23T20:46:52Z' },
    { id: 'e2', action: 'order.remove_item', label: 'Removed items', by: 'Ravi Yadav', by_staff_id: RAVI, summary: null, details: null,
      at: '2026-10-22T10:00:00Z' },
  ],
};

describe('owner watch helpers', () => {
  it('adds up money lost', () => {
    expect(totalLoss(watch.totals)).toBe(459);
    expect(staffLoss(watch.by_staff[1]!)).toBe(289);
  });

  it('ranks staff by money lost', () => {
    expect(rankStaff(watch.by_staff).map((r) => r.name)).toEqual(['Anil Kumar', 'Ravi Yadav']);
    expect(staffOptions(watch).map((p) => p.id)).toEqual([ANIL, RAVI]);
  });

  it('narrows everything to one person', () => {
    const { watch: w, totals } = filterByStaff(watch, RAVI);
    expect(w.items.map((i) => i.name)).toEqual(['Jeera Rice']);
    expect(w.cancelled_bills).toHaveLength(0);
    expect(w.menu_changes).toHaveLength(0);
    expect(totals.items_removed_value).toBe(120);
    expect(totals.on_the_house).toBe(0);

    const anil = filterByStaff(watch, ANIL);
    expect(anil.watch.cancelled_bills).toHaveLength(1);
    expect(anil.totals.on_the_house).toBe(1);
    expect(anil.totals.on_the_house_value).toBe(50);
    expect(anil.totals.menu_changes).toBe(1);
  });

  it('leaves the watch untouched without a filter', () => {
    expect(filterByStaff(watch, null).totals).toBe(watch.totals);
  });

  it('groups the timeline by day, newest first', () => {
    const groups = groupByDay(watch.events, (iso) => iso.slice(0, 10));
    expect(groups.map((g) => g.day)).toEqual(['2026-10-23', '2026-10-22']);
  });
});

describe('owner watch rows (one DataList per tab)', () => {
  it('maps every tab to flat rows with the bill to open', () => {
    expect(watchRows('bills', watch, false)).toEqual([expect.objectContaining({ title: 'Bill B1', amount: 168, orderId: 'o1', detail: '“Left”', by: 'Anil Kumar' })]);
    const items = watchRows('items', watch, false);
    expect(items.map((r) => r.kind)).toEqual(['order.remove_item', 'order.void_item']);
    expect(items[0].badges.map((b) => b.label)).toEqual(['Before kitchen', 'Bill cancelled']);
    expect(watchRows('comps', watch, false)[0]).toMatchObject({ title: '1 × Gulab Jamun', amount: 50, orderId: 'o2' });
    expect(watchRows('comps', watch, true)[0]).toMatchObject({ kind: 'order.comp', amount: 50, by: 'Anil Kumar' });
    expect(watchRows('menu', watch, false)[0]).toMatchObject({ kind: 'menu.change', detail: 'Price ₹120 → ₹130' });
    expect(watchRows('timeline', watch, false).map((r) => r.key)).toEqual(['e1', 'e2']);
    expect(watchRows('staff', watch, false)).toEqual([]);
  });

  it('counts each tab', () => {
    expect(viewCount('staff', watch, watch.totals, 0)).toBe(2);
    expect(viewCount('comps', watch, watch.totals, 0)).toBe(1);
    expect(viewCount('requests', watch, watch.totals, 3)).toBe(3);
  });
});
