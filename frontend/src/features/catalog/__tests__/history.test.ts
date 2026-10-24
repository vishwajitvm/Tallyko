import { parseWhen, priceDiff, snapshotFacts, snapshotPrice, whenLabel } from '../history';

describe('item history helpers', () => {
  it('parses server timestamps, including the "+00:00Z" form', () => {
    expect(parseWhen('2026-10-24T10:00:00Z')?.toISOString()).toBe('2026-10-24T10:00:00.000Z');
    expect(parseWhen('2026-10-24T10:00:00+00:00Z')?.toISOString()).toBe('2026-10-24T10:00:00.000Z');
    expect(parseWhen('2026-10-24T10:00:00')?.toISOString()).toBe('2026-10-24T10:00:00.000Z');
    expect(parseWhen('nonsense')).toBeNull();
  });
  it('labels today and yesterday', () => {
    const now = new Date(2026, 9, 24, 18, 0);
    expect(whenLabel(new Date(2026, 9, 24, 9, 5).toISOString(), now)).toMatch(/^Today, /);
    expect(whenLabel(new Date(2026, 9, 23, 9, 5).toISOString(), now)).toMatch(/^Yesterday, /);
    expect(whenLabel(new Date(2026, 8, 1, 9, 5).toISOString(), now)).toMatch(/2026/);
  });
  it('shows a price diff between versions', () => {
    expect(priceDiff({ base_price: 340 }, { base_price: 300 })).toEqual({ from: '₹300', to: '₹340', up: true });
    expect(priceDiff({ base_price: 280 }, { base_price: 300 })).toEqual({ from: '₹300', to: '₹280', up: false });
    expect(priceDiff({ base_price: 300 }, { base_price: 300 })).toBeNull();
    expect(priceDiff({ base_price: 300 }, null)).toBeNull();
    expect(snapshotPrice({ base_price: 150, variants: [['Full', 289], ['Half', 150]] })).toBe('₹150 – ₹289');
  });
  it('lists readable facts', () => {
    const facts = snapshotFacts(
      { name: 'Coke', base_price: 45, category_id: 'c1', channel_prices: { SWIGGY: { price: 60 }, ZOMATO: { available: false } }, is_active: false },
      { categoryName: (id) => (id === 'c1' ? 'Beverages' : undefined), channelName: (c) => ({ SWIGGY: 'Swiggy', ZOMATO: 'Zomato' } as Record<string, string>)[c] },
    );
    expect(facts).toEqual([
      { label: 'Name', value: 'Coke' }, { label: 'Price', value: '₹45' }, { label: 'Category', value: 'Beverages' },
      { label: 'App prices', value: 'Swiggy ₹60 · Not on Zomato' }, { label: 'On the menu', value: 'No (removed)' },
    ]);
  });
});
