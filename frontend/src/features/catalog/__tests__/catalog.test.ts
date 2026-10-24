import { barcodeError, parseMoney, priceLabel, sanitizeInt, sanitizeMoney } from '../utils';
import { categoryKey, duplicateKeys, guessVeg, rowProblems, rowsFromScan, tidyCategory, toImportItems } from '../scan/review';
import { barcodeFormatFor, buildLabelsHtml, countLabels } from '../labels';

describe('money / quantity sanitising', () => {
  it('keeps prices non-negative with at most 2 decimals', () => {
    expect(sanitizeMoney('-0120.555')).toBe('120.55');
    expect(sanitizeMoney('1,200')).toBe('1200');
    expect(sanitizeMoney('.5')).toBe('0.5');
    expect(sanitizeMoney('12.3.4')).toBe('12.34');
    expect(sanitizeMoney('abc')).toBe('');
    expect(sanitizeMoney('123456789')).toBe('1234567');
  });
  it('parses money', () => {
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('.')).toBeNull();
    expect(parseMoney('0')).toBe(0);
    expect(parseMoney('99.999')).toBe(100);
  });
  it('sanitises integers', () => {
    expect(sanitizeInt('-5')).toBe('5');
    expect(sanitizeInt('-5', true)).toBe('-5');
    expect(sanitizeInt('007')).toBe('7');
    expect(sanitizeInt('1.5')).toBe('15');
  });
  it('validates barcodes like the backend', () => {
    expect(barcodeError('8901234567890')).toBeNull();
    expect(barcodeError('AB-12.3 X')).toBeNull();
    expect(barcodeError('a/b')).not.toBeNull();
    expect(barcodeError('x'.repeat(49))).not.toBeNull();
  });
  it('labels price ranges for items with options', () => {
    expect(priceLabel({ base_price: 50, variants: [] })).toBe('₹50');
    expect(priceLabel({ base_price: 0, variants: [{ id: '1', name: 'Half', price: 120 }, { id: '2', name: 'Full', price: 200 }] })).toBe('₹120 – ₹200');
  });
});

describe('menu scan review', () => {
  const scan = [
    { name: 'Dal Makhani', price: 200, category: 'MAIN COURSE', variants: [{ name: 'Half', price: 120 }, { name: 'Full', price: 200 }], confidence: 0.95 },
    { name: 'Chicken Curry', price: null, category: 'Maincourse', variants: [], confidence: 0.55 },
    { name: 'Masala Chai', price: 20, category: null, variants: [], confidence: 0.9 },
    { name: 'masala chai', price: 20, category: null, variants: [], confidence: 0.9 },
  ];

  it('marks existing items, repeats and reuses known category spellings', () => {
    const rows = rowsFromScan(scan, new Set(['dal makhani']), ['Main Course']);
    expect(rows[0]!.existing).toBe(true);
    expect(rows[0]!.include).toBe(false);
    expect(rows[0]!.category).toBe('Main Course');
    expect(rows[1]!.category).toBe('Main Course');
    expect(rows[3]!.include).toBe(false); // repeat in the same scan
    expect(rows[0]!.price).toBe(''); // price comes from options
  });

  it('blocks rows without a price and builds the import payload', () => {
    const rows = rowsFromScan(scan, new Set(), []);
    expect(rowProblems(rows[1]!)).toContain('price');
    expect(rowProblems(rows[0]!)).toEqual([]);
    const items = toImportItems(rows, { taxRate: 5, applyVeg: true });
    expect(items.map((i) => i.name)).toEqual(['Dal Makhani', 'Masala Chai']);
    expect(items[0]).toMatchObject({ price: 120, category: 'Main Course', tax_rate: 5, is_veg: true, variants: [{ name: 'Half', price: 120 }, { name: 'Full', price: 200 }] });
    expect(toImportItems(rows, { taxRate: null, applyVeg: false })[0]!.is_veg).toBeNull();
  });

  it('flags duplicate names among ticked rows', () => {
    const rows = rowsFromScan(scan, new Set(), []).map((r) => ({ ...r, include: true }));
    expect(duplicateKeys(rows).has('masala chai')).toBe(true);
  });

  it('guesses veg / non-veg conservatively', () => {
    expect(guessVeg('Egg Fried Rice')).toBe(false);
    expect(guessVeg('Chicken Biryani')).toBe(false);
    expect(guessVeg('Paneer Tikka')).toBe(true);
    expect(guessVeg('Special Thali')).toBeNull();
  });

  it('normalises category names', () => {
    expect(categoryKey('Main-Course ')).toBe(categoryKey('maincourse'));
    expect(tidyCategory('SOUTH INDIAN')).toBe('South Indian');
    expect(tidyCategory('McDonald Specials')).toBe('McDonald Specials');
  });
});

describe('barcode labels', () => {
  it('picks a symbology and skips unprintable codes', () => {
    expect(barcodeFormatFor('2000000000015')).toBe('ean13');
    expect(barcodeFormatFor('SKU-001')).toBe('code128');
    expect(barcodeFormatFor('café')).toBeNull();
    const items = [
      { name: 'Paneer <Roll>', price: 120, barcode: '2000000000015', copies: 2 },
      { name: 'Bad', price: 10, barcode: 'café', copies: 3 },
    ];
    expect(countLabels(items)).toBe(2);
    const html = buildLabelsHtml(items, { layout: 'a4-24', symbol: '₹', businessName: 'Demo', showPrice: true });
    expect(html.match(/class="label"/g)).toHaveLength(2);
    expect(html).toContain('Paneer &lt;Roll&gt;');
    expect(html).toContain('<svg');
    const roll = buildLabelsHtml(items, { layout: 'roll-50x25', symbol: '₹', showPrice: false });
    expect(roll).toContain('size: 50mm 25mm');
    expect(roll).not.toContain('₹120');
  });
});
