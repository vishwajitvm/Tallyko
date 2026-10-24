import { filterItems, itemKey, itemTotals, shareLabel, sortItems } from '../itemSales';

const rows = [
  { name: 'Dal Makhani', variant: 'Half', quantity: 10, revenue: 1500, tax: 75 },
  { name: 'Butter Naan', variant: null, quantity: 40, revenue: 2000, tax: 100 },
  { name: 'Dal Makhani', variant: 'Full', quantity: 5, revenue: 1250, tax: 62.5 },
];

describe('item-wise sales', () => {
  it('filters by name or option', () => {
    expect(filterItems(rows, 'dal').length).toBe(2);
    expect(filterItems(rows, 'full').map(itemKey)).toEqual(['Dal Makhani|Full']);
  });

  it('sorts by any column', () => {
    expect(sortItems(rows, { key: 'revenue', dir: 'desc' }).map((r) => r.quantity)).toEqual([40, 10, 5]);
    expect(sortItems(rows, { key: 'qty', dir: 'asc' }).map((r) => r.quantity)).toEqual([5, 10, 40]);
    expect(sortItems(rows, { key: 'name', dir: 'asc' })[0].name).toBe('Butter Naan');
  });

  it('totals and shares', () => {
    expect(itemTotals(rows)).toEqual({ qty: 55, revenue: 4750, tax: 237.5 });
    expect(shareLabel(2000, 4750)).toBe('42%');
    expect(shareLabel(1, 4750)).toBe('<0.1%');
    expect(shareLabel(5, 0)).toBe('');
  });
});
