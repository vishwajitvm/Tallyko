/// <reference types="jest" />
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
import { isFreeItem, previewTotals, spreadOfferDiscount } from '@/lib/billing';

const exclusive = { prices_include_tax: false };
const round = (n: number) => Math.round(n * 100) / 100;

describe('offer discounts in the price preview', () => {
  const rows = [
    { unitPrice: 140, quantity: 2, taxRate: 5 },
    { unitPrice: 110, quantity: 1, taxRate: 5 },
  ];
  it('matches the server for a 10% bill offer', () => {
    const lineDiscounts = spreadOfferDiscount(rows, exclusive, 39);
    expect(lineDiscounts).toEqual([28, 11]);
    // server: subtotal 390, discount 39, tax 17.55, total 369
    expect(previewTotals(rows, exclusive, null, lineDiscounts)).toMatchObject({ subtotal: 390, discount: 39, offerDiscount: 39, tax: 17.55, total: 369 });
  });
  it('targets only covered lines and applies the manual discount to what is left', () => {
    const mixed = [{ unitPrice: 100, quantity: 1, taxRate: 5 }, { unitPrice: 100, quantity: 1, taxRate: 18 }];
    const ld = spreadOfferDiscount(mixed, exclusive, 20, (i) => i === 1);
    expect(ld).toEqual([0, 20]);
    const p = previewTotals(mixed, exclusive, { type: 'percent', value: 10 }, ld);
    // offer 20 on the 18% line; then 10% of the remaining 180 = 18, spread 100:80
    expect(p.offerDiscount).toBe(20);
    expect(p.discount).toBe(38);
    expect(p.tax).toBe(round(((100 - 10) * 5) / 100 + ((100 - 20 - 8) * 18) / 100));
  });
  it('keeps menu prices when nothing is discounted (tax inclusive)', () => {
    const p = previewTotals([{ unitPrice: 105, quantity: 1, taxRate: 5 }], { prices_include_tax: true });
    expect(p.total).toBe(105);
    expect(p.offerDiscount).toBe(0);
  });
});

describe('free items', () => {
  it('recognises lines added by a free-item offer', () => {
    expect(isFreeItem({ unit_price: 0, notes: 'Free — Weekend combo' })).toBe(true);
    expect(isFreeItem({ unit_price: 0, notes: 'no onion' })).toBe(false);
    expect(isFreeItem({ unit_price: 50, notes: null, is_free: false })).toBe(false);
    expect(isFreeItem({ unit_price: 0, notes: null, is_free: true })).toBe(true);
  });
});
