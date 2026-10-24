/// <reference types="jest" />
import {
  buildKotEscPos,
  buildKotHtml,
  buildKotText,
  buildReceiptEscPos,
  buildReceiptHtml,
  buildReceiptText,
  buildUpiUrl,
  formatMoney,
  formatQty,
  twoCol,
  wrapText,
  type KotData,
  type ReceiptData,
} from '../receipt';

const sample = (over: Partial<ReceiptData> = {}): ReceiptData => ({
  business: {
    name: 'Sharma Ji Ka Dhaba',
    address: '12, MG Road, Indiranagar, Bengaluru 560038',
    phone: '+91 98450 12345',
    gstin: '29ABCDE1234F1Z5',
    fssai: '11223344556677',
    footer: 'Goods once sold will not be taken back',
    currencySymbol: '₹',
    upiId: 'sharmaji@okicici',
  },
  billNo: 'INV-2026-000123',
  code: 'TALLYKO-123',
  tokenNo: 42,
  createdAt: '2026-10-23T14:05:00',
  orderType: 'dine_in',
  channel: null,
  tableLabel: 'T4',
  customerName: 'Ravi Kumar',
  customerPhone: '9876543210',
  cashier: 'Anita',
  items: [
    { name: 'Paneer Tikka', variant: null, quantity: 2, unitPrice: 180, lineTotal: 360, taxRate: 5 },
    {
      name: 'Special Hyderabadi Chicken Dum Biryani Family Pack',
      variant: 'Large',
      quantity: 1,
      unitPrice: 650,
      lineTotal: 650,
      taxRate: 5,
    },
    { name: 'पनीर टिक्का', quantity: 1, unitPrice: 200, lineTotal: 200, taxRate: 5 },
    { name: 'Party Platter', quantity: 3, unitPrice: 12500, lineTotal: 37500, taxRate: 5 },
  ],
  subtotal: 38710,
  discount: 100,
  taxBreakup: [{ rate: 5, taxable: 38610, cgst: 965.25, sgst: 965.25 }],
  taxTotal: 1930.5,
  roundOff: 0.5,
  total: 40541,
  pricesIncludeTax: false,
  payments: [
    { method: 'cash', amount: 2000 },
    { method: 'upi', amount: 39000 },
  ],
  change: 459,
  loyaltyEarned: 40,
  ...over,
});

describe('formatting helpers', () => {
  it('formats money with Indian grouping', () => {
    expect(formatMoney(0)).toBe('0.00');
    expect(formatMoney(999)).toBe('999.00');
    expect(formatMoney(1000)).toBe('1,000.00');
    expect(formatMoney(100000)).toBe('1,00,000.00');
    expect(formatMoney(1234567.5)).toBe('12,34,567.50');
    expect(formatMoney(-1500.256)).toBe('-1,500.26');
    expect(formatMoney(-0.001)).toBe('0.00');
    expect(formatMoney(12500, false)).toBe('12500.00');
    expect(formatMoney(NaN)).toBe('0.00');
  });

  it('formats quantities', () => {
    expect(formatQty(2)).toBe('2');
    expect(formatQty(1.5)).toBe('1.5');
    expect(formatQty(0.125)).toBe('0.125');
  });

  it('wraps text and builds two-column rows', () => {
    expect(wrapText('Special Hyderabadi Chicken', 12)).toEqual(['Special', 'Hyderabadi', 'Chicken']);
    expect(wrapText('ABCDEFGHIJKLMNOP', 6)).toEqual(['ABCDEF', 'GHIJKL', 'MNOP']);
    expect(wrapText('', 10)).toEqual(['']);
    expect(twoCol('Subtotal', '100.00', 32)).toEqual(['Subtotal' + ' '.repeat(18) + '100.00']);
    twoCol('A very long label that will not fit on one line', '1,00,000.00', 32).forEach((l) =>
      expect(l.length).toBeLessThanOrEqual(32),
    );
  });

  it('builds UPI deep links', () => {
    expect(buildUpiUrl('shop@ybl', 'Chai & Co', 99.5, 'Bill 7')).toBe(
      'upi://pay?pa=shop@ybl&pn=Chai%20%26%20Co&am=99.50&cu=INR&tn=Bill%207',
    );
  });
});

describe.each([
  [58, 32],
  [80, 48],
] as const)('receipt text %imm', (width, W) => {
  const text = buildReceiptText(sample(), width);
  const lines = text.split('\n');

  it('keeps every line within the paper width and pure ASCII', () => {
    lines.forEach((l) => expect(l.length).toBeLessThanOrEqual(W));
    expect(/^[\x20-\x7e\n]*$/.test(text)).toBe(true);
    expect(text).not.toContain('₹');
  });

  it('has exact-width header, rules and item rows', () => {
    const header = lines.find((l) => l.startsWith('Item'))!;
    expect(header).toHaveLength(W);
    expect(header.trimEnd().endsWith('Amount')).toBe(true);
    expect(lines.filter((l) => /^-+$/.test(l)).every((l) => l.length === W)).toBe(true);
    expect(lines.filter((l) => /^=+$/.test(l)).every((l) => l.length === W)).toBe(true);
    const row = lines.find((l) => l.startsWith('Paneer Tikka'))!;
    expect(row).toHaveLength(W);
    expect(row.endsWith('360.00')).toBe(true);
    expect(row).toMatch(/ 2 +180\.00 +360\.00$/);
  });

  it('wraps long names and transliterates Hindi', () => {
    const idx = lines.findIndex((l) => l.startsWith('Special'));
    expect(idx).toBeGreaterThan(-1);
    expect(lines[idx]).toHaveLength(W);
    expect(lines[idx]!.endsWith('650.00')).toBe(true);
    // continuation lines carry the rest of the name
    const rest = lines.slice(idx + 1, idx + 6).join(' ');
    expect(rest).toContain('Pack');
    expect(rest).toContain('(Large)');
    expect(text).toContain('Paneer Tikka');
    expect(lines.filter((l) => l.startsWith('Paneer Tikka'))).toHaveLength(2);
  });

  it('falls back to "qty x rate" layout when numbers are too wide', () => {
    if (W === 32) {
      expect(lines.some((l) => /^ {2}3 x 12500\.00 +37500\.00$/.test(l))).toBe(true);
    } else {
      expect(lines.some((l) => /^Party Platter +3 +12500\.00 +37500\.00$/.test(l))).toBe(true);
    }
  });

  it('includes header, GST and totals', () => {
    expect(text).toContain('Sharma Ji Ka Dhaba');
    expect(text).toContain('GSTIN: 29ABCDE1234F1Z5');
    expect(text).toContain('FSSAI: 11223344556677');
    expect(text).toContain('TAX INVOICE');
    expect(text).toContain('Bill: INV-2026-000123');
    expect(text).toContain('23/10/2026 14:05');
    expect(text).toContain('TOKEN 42');
    expect(text).toContain('Table: T4');
    expect(text).toContain('Type: Dine In');
    expect(text).toMatch(/Subtotal +38,710\.00/);
    expect(text).toMatch(/Discount +-100\.00/);
    expect(text).toMatch(/CGST @2\.5% +965\.25/);
    expect(text).toMatch(/SGST @2\.5% +965\.25/);
    expect(text).toMatch(/Round Off +\+0\.50/);
    expect(text).toMatch(/TOTAL +Rs\.40,541\.00/);
    expect(text).toMatch(/Paid \(CASH\) +2,000\.00/);
    expect(text).toMatch(/Paid \(UPI\) +39,000\.00/);
    expect(text).toMatch(/Change +459\.00/);
    expect(text).toContain('Loyalty points earned: 40');
    expect(text).toContain('TALLYKO-123');
    expect(text).toContain('[ UPI QR ]');
    expect(text).toContain('UPI: sharmaji@okicici');
    expect(text).toContain('Goods once sold');
    expect(text).toContain('Thank you');
  });
});

describe('receipt variants', () => {
  it('handles zero items, duplicates, offline and no GSTIN', () => {
    const text = buildReceiptText(
      sample({
        items: [],
        isDuplicate: true,
        offline: true,
        business: { name: 'Chai Point', currencySymbol: '₹' },
        payments: [],
        tokenNo: null,
      }),
      58,
    );
    expect(text).toContain('(no items)');
    expect(text).toContain('*** DUPLICATE ***');
    expect(text).toContain('Offline');
    expect(text).toContain('BILL');
    expect(text).not.toContain('TAX INVOICE');
    expect(text).not.toContain('UPI QR');
    expect(text).toMatch(/Payment +DUE/);
  });

  it('notes tax-inclusive pricing', () => {
    expect(buildReceiptText(sample({ pricesIncludeTax: true }), 80)).toContain('(Prices inclusive of GST)');
  });
});

describe('receipt ESC/POS', () => {
  const bytes = Array.from(buildReceiptEscPos(sample(), 58));
  const find = (seq: number[]) => {
    outer: for (let i = 0; i <= bytes.length - seq.length; i++) {
      for (let j = 0; j < seq.length; j++) if (bytes[i + j] !== seq[j]) continue outer;
      return i;
    }
    return -1;
  };

  it('starts with init and ends with a cut', () => {
    expect(bytes.slice(0, 2)).toEqual([0x1b, 0x40]);
    expect(bytes.slice(-4)).toEqual([0x1d, 0x56, 0x42, 0x00]);
  });

  it('contains the barcode and UPI QR commands', () => {
    expect(find([0x1d, 0x6b, 73, 13, 0x7b, 0x42])).toBeGreaterThan(0);
    expect(find([0x1d, 0x28, 0x6b, 4, 0, 0x31, 0x41, 0x32, 0])).toBeGreaterThan(0);
    const text = String.fromCharCode(...bytes);
    expect(text).toContain('upi://pay?pa=sharmaji@okicici&pn=Sharma%20Ji%20Ka%20Dhaba&am=40541.00&cu=INR');
    expect(text).toContain('Rs.40,541.00');
  });

  it('can skip barcode/QR and kick the drawer', () => {
    const b = Array.from(buildReceiptEscPos(sample(), 80, { barcode: false, qr: false, openDrawer: true }));
    const s = String.fromCharCode(...b);
    expect(s).not.toContain('upi://');
    expect(b.slice(-5)).toEqual([0x1b, 0x70, 0, 25, 250]);
  });

  it('never sends non-ASCII text bytes', () => {
    expect(bytes.every((x) => x < 0x80)).toBe(true);
  });
});

describe('receipt HTML', () => {
  it('contains svg barcode, UPI QR and keeps unicode', () => {
    const html = buildReceiptHtml(sample(), 58);
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toMatch(/@page \{ size: 58mm \d+mm; margin: 0; \}/);
    expect(html).toContain('aria-label="TALLYKO-123"');
    expect(html).toContain('aria-label="QR code"');
    expect((html.match(/<svg/g) ?? []).length).toBe(2);
    expect(html).toContain('Scan &amp; pay via UPI');
    expect(html).toContain('पनीर टिक्का');
    expect(html).toContain('₹40,541.00');
    expect(html).toContain('CGST @2.5%');
    expect(html).toContain('TAX INVOICE');
  });

  it('omits the QR without upiId and escapes HTML', () => {
    const html = buildReceiptHtml(
      sample({ business: { name: '<script>alert(1)</script>', currencySymbol: '₹' } }),
      80,
    );
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect((html.match(/<svg/g) ?? []).length).toBe(1);
    expect(html).toContain('size: 80mm');
  });
});

describe('KOT', () => {
  const kot: KotData = {
    kotNo: 17,
    orderType: 'takeaway',
    tableLabel: null,
    tokenNo: 8,
    channel: 'swiggy',
    brand: 'Biryani Bros',
    createdAt: '2026-10-23T14:05:00',
    items: [
      { name: 'Chicken Biryani', variant: 'Full', quantity: 2, notes: 'Less spicy' },
      { name: 'मसाला चाय', quantity: 1 },
    ],
    notes: 'Pack separately',
  };

  it('renders text within width', () => {
    for (const [w, W] of [
      [58, 32],
      [80, 48],
    ] as const) {
      const text = buildKotText(kot, w);
      text.split('\n').forEach((l) => expect(l.length).toBeLessThanOrEqual(W));
      expect(text).toContain('KOT #17');
      expect(text).toContain('TAKEAWAY');
      expect(text).toContain('TOKEN 8');
      expect(text).toContain('Channel: Swiggy');
      expect(text).toMatch(/Chicken Biryani +2/);
      expect(text).toContain('- Full');
      expect(text).toContain('>> Less spicy');
      expect(text).toContain('Masala Chay');
      expect(text).toContain('NOTE: Pack separately');
    }
  });

  it('renders ESC/POS and HTML', () => {
    const b = Array.from(buildKotEscPos(kot, 80));
    expect(b.slice(0, 2)).toEqual([0x1b, 0x40]);
    expect(b.slice(-4)).toEqual([0x1d, 0x56, 0x42, 0x00]);
    const html = buildKotHtml(kot, 80);
    expect(html).toContain('KOT #17');
    expect(html).toContain('मसाला चाय');
    expect(html).toContain('&gt;&gt; Less spicy');
  });
});
