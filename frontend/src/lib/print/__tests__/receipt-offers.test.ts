/// <reference types="jest" />
import { buildReceiptHtml, buildReceiptText, discountRows, receiptTitle, taxRows, type ReceiptData } from '../receipt';

const base = (over: Partial<ReceiptData> = {}): ReceiptData => ({
  business: { name: 'Chai Point', currencySymbol: '₹', gstin: '29ABCDE1234F1Z5' },
  billNo: 'INV/26-27/00063',
  code: 'ABC123',
  createdAt: '2026-10-24T18:05:00',
  orderType: 'TAKEAWAY',
  items: [
    { name: 'Paneer Tikka', quantity: 2, unitPrice: 140, lineTotal: 280, taxRate: 5 },
    { name: 'Masala Chai', quantity: 1, unitPrice: 0, lineTotal: 0, taxRate: 0, free: true },
  ],
  subtotal: 280,
  discount: 38,
  offer: { name: 'Happy hours', discount: 28 },
  billType: 'tax_invoice',
  taxBreakup: [{ rate: 5, taxable: 242, cgst: 6.05, sgst: 6.05 }],
  taxTotal: 12.1,
  roundOff: -0.1,
  total: 254,
  pricesIncludeTax: false,
  payments: [{ method: 'UPI', amount: 254 }],
  ...over,
});

describe('receipt title', () => {
  it('follows the bill type, falling back to the GSTIN', () => {
    expect(receiptTitle(base())).toBe('TAX INVOICE');
    expect(receiptTitle(base({ billType: 'bill_of_supply' }))).toBe('BILL OF SUPPLY');
    expect(receiptTitle(base({ billType: undefined }))).toBe('TAX INVOICE');
    expect(receiptTitle(base({ billType: undefined, business: { name: 'X', currencySymbol: '₹' } }))).toBe('BILL');
  });
  it('prints Bill of Supply instead of Tax Invoice', () => {
    const text = buildReceiptText(base({ billType: 'bill_of_supply', taxBreakup: [], taxTotal: 0 }), 80);
    expect(text).toContain('BILL OF SUPPLY');
    expect(text).not.toContain('TAX INVOICE');
    expect(buildReceiptHtml(base({ billType: 'bill_of_supply' }), 80)).toContain('BILL OF SUPPLY');
  });
});

describe('offers on the receipt', () => {
  it('splits the offer from other discounts', () => {
    expect(discountRows(base())).toEqual([{ label: 'Offer: Happy hours', amount: 28 }, { label: 'Other discount', amount: 10 }]);
    expect(discountRows(base({ offer: null }))).toEqual([{ label: 'Discount', amount: 38 }]);
    expect(discountRows(base({ discount: 28 }))).toEqual([{ label: 'Offer: Happy hours', amount: 28 }]);
    expect(discountRows(base({ discount: 0, offer: { name: 'Free chai', discount: 0 } }))).toEqual([]);
  });
  it('prints the offer line and free items', () => {
    for (const width of [58, 80] as const) {
      const text = buildReceiptText(base(), width);
      expect(text).toMatch(/Offer: Happy hours +-28\.00/);
      expect(text).toMatch(/Other discount +-10\.00/);
      expect(text).toMatch(/Masala Chai.*FREE/);
    }
    const html = buildReceiptHtml(base(), 80);
    expect(html).toContain('Offer: Happy hours');
    expect(html).toContain('FREE');
  });
});

describe('GST rows', () => {
  it('shows IGST for inter-state lines, else CGST + SGST', () => {
    expect(taxRows([{ rate: 18, taxable: 100, cgst: 0, sgst: 0, igst: 18 }])).toEqual([{ label: 'IGST @18%', amount: 18 }]);
    expect(taxRows([{ rate: 5, taxable: 100, cgst: 2.5, sgst: 2.5 }])).toEqual([
      { label: 'CGST @2.5%', amount: 2.5 }, { label: 'SGST @2.5%', amount: 2.5 },
    ]);
    const text = buildReceiptText(base({ taxBreakup: [{ rate: 12, taxable: 242, cgst: 0, sgst: 0, igst: 29.04 }] }), 80);
    expect(text).toMatch(/IGST @12% +29\.04/);
    expect(text).not.toContain('CGST');
  });
});
