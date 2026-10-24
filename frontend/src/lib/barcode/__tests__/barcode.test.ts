/// <reference types="jest" />
import { CODE128_PATTERNS, code128Segments, encodeCode128, isCode128Encodable } from '../code128';
import { ean13CheckDigit, encodeEan13, isValidEan13, makeInternalEan13, normalizeEan13 } from '../ean13';
import { qrMatrix, qrSvg, toUtf8ByteString } from '../qr';
import { barcodeGeometry, barcodeSvg } from '../svg';

const START_B_BITS = '11010010000';
const START_C_BITS = '11010011100';
const STOP_BITS = '1100011101011';

describe('Code 128', () => {
  it('pattern table is well-formed (106 symbols of 11 modules + 13-module stop, all unique)', () => {
    expect(CODE128_PATTERNS).toHaveLength(107);
    CODE128_PATTERNS.slice(0, 106).forEach((p) => {
      expect(p).toHaveLength(6);
      expect([...p].reduce((s, c) => s + Number(c), 0)).toBe(11);
    });
    expect([...CODE128_PATTERNS[106]!].reduce((s, c) => s + Number(c), 0)).toBe(13);
    expect(new Set(CODE128_PATTERNS).size).toBe(107);
  });

  it('encodes "TALLYKO-123" in set B with check digit 91', () => {
    const enc = encodeCode128('TALLYKO-123');
    // T A L L Y K O - 1 2 3 → char code - 32
    expect(enc.values).toEqual([104, 52, 33, 44, 44, 57, 43, 47, 13, 17, 18, 19, 91]);
    expect(enc.checkDigit).toBe(91);
    expect(enc.segments).toEqual([{ set: 'B', data: 'TALLYKO-123' }]);
    expect(enc.totalModules).toBe(13 * 11 + 13);
    expect(enc.bits.startsWith(START_B_BITS)).toBe(true);
    expect(enc.bits.endsWith(STOP_BITS)).toBe(true);
    // Third symbol is "A" (value 33) = 10100011000
    expect(enc.bits.slice(22, 33)).toBe('10100011000');
    // Widths sum to the module count and start with a bar
    expect(enc.widths.reduce((a, b) => a + b, 0)).toBe(enc.totalModules);
    expect(enc.bits[0]).toBe('1');
  });

  it('uses set C for an all-numeric even-length string', () => {
    const enc = encodeCode128('12345678');
    // 105 + 12*1 + 34*2 + 56*3 + 78*4 = 665; 665 % 103 = 47
    expect(enc.values).toEqual([105, 12, 34, 56, 78, 47]);
    expect(enc.checkDigit).toBe(47);
    expect(enc.totalModules).toBe(6 * 11 + 13);
    expect(enc.bits.startsWith(START_C_BITS)).toBe(true);
    expect(enc.bits.endsWith(STOP_BITS)).toBe(true);
  });

  it('switches B → C for a trailing digit run', () => {
    const enc = encodeCode128('AB123456');
    // 104 + 33 + 34*2 + 99*3 + 12*4 + 34*5 + 56*6 = 1056; 1056 % 103 = 26
    expect(enc.values).toEqual([104, 33, 34, 99, 12, 34, 56, 26]);
    expect(code128Segments('AB123456')).toEqual([
      { set: 'B', data: 'AB' },
      { set: 'C', data: '123456' },
    ]);
  });

  it('handles odd digit runs and short numerics', () => {
    expect(code128Segments('12345')).toEqual([
      { set: 'C', data: '1234' },
      { set: 'B', data: '5' },
    ]);
    expect(code128Segments('123')).toEqual([{ set: 'B', data: '123' }]);
    expect(code128Segments('X1234567')).toEqual([
      { set: 'B', data: 'X1' },
      { set: 'C', data: '234567' },
    ]);
    expect(code128Segments('A12B')).toEqual([{ set: 'B', data: 'A12B' }]);
  });

  it('rejects unsupported characters', () => {
    expect(isCode128Encodable('ORD-1')).toBe(true);
    expect(isCode128Encodable('')).toBe(false);
    expect(isCode128Encodable('₹10')).toBe(false);
    expect(() => encodeCode128('a\tb')).toThrow(RangeError);
  });
});

describe('EAN-13', () => {
  it('computes check digits for known codes', () => {
    expect(ean13CheckDigit('400638133393')).toBe(1);
    expect(isValidEan13('4006381333931')).toBe(true);
    // 8901030865278 has a wrong check digit; the correct one for 890103086527 is 5.
    expect(ean13CheckDigit('890103086527')).toBe(5);
    expect(isValidEan13('8901030865278')).toBe(false);
    expect(isValidEan13('8901030865275')).toBe(true);
    expect(isValidEan13('123')).toBe(false);
    expect(isValidEan13('abcdefghijklm')).toBe(false);
  });

  it('normalises 12 → 13 digits and rejects bad check digits', () => {
    expect(normalizeEan13('400638133393')).toBe('4006381333931');
    expect(() => normalizeEan13('4006381333932')).toThrow(RangeError);
  });

  it('encodes 95 modules with guards and first-digit parity', () => {
    const enc = encodeEan13('4006381333931');
    expect(enc.bits).toHaveLength(95);
    expect(enc.bits.slice(0, 3)).toBe('101');
    expect(enc.bits.slice(45, 50)).toBe('01010');
    expect(enc.bits.slice(92)).toBe('101');
    // first digit 4 → parity LGLLGG; digit 1 = '0' with L code, digit 2 = '0' with G code
    expect(enc.bits.slice(3, 10)).toBe('0001101');
    expect(enc.bits.slice(10, 17)).toBe('0100111');
    // right half digit 7 = '3' with R code
    expect(enc.bits.slice(50, 57)).toBe('1000010');
  });

  it('makes valid in-store codes in the 20-29 range', () => {
    expect(makeInternalEan13(42)).toBe('2000000000428');
    const c = makeInternalEan13(123456, '29');
    expect(c).toHaveLength(13);
    expect(c.startsWith('29')).toBe(true);
    expect(isValidEan13(c)).toBe(true);
    expect(() => makeInternalEan13(1, '89')).toThrow(RangeError);
    expect(() => makeInternalEan13(-1)).toThrow(RangeError);
    expect(() => makeInternalEan13(1e12)).toThrow(RangeError);
  });
});

describe('SVG rendering', () => {
  it('renders a Code 128 svg with text', () => {
    const svg = barcodeSvg('TALLYKO-123', { format: 'code128', height: 40, moduleWidth: 2 });
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('width="352"'); // (156 + 20 quiet) * 2
    expect(svg).toContain('>TALLYKO-123</text>');
    expect(barcodeSvg('X', { showText: false })).not.toContain('<text');
  });

  it('escapes text and renders EAN-13 guard bars taller', () => {
    expect(barcodeSvg('A<B&"', {})).toContain('A&lt;B&amp;&quot;');
    const geom = barcodeGeometry('4006381333931', 'ean13');
    expect(geom.bars.filter((b) => b.guard)).toHaveLength(6);
    expect(geom.text.map((t) => t.text).join('')).toBe('4006381333931');
    expect(barcodeSvg('400638133393', { format: 'ean13' })).toContain('>006381</text>');
  });

  it('throws for invalid values', () => {
    expect(() => barcodeSvg('12', { format: 'ean13' })).toThrow(RangeError);
  });
});

describe('QR', () => {
  it('builds a square matrix with finder patterns', () => {
    const m = qrMatrix('upi://pay?pa=shop@upi&pn=Shop&am=10.00&cu=INR');
    expect(m.length).toBeGreaterThanOrEqual(21);
    m.forEach((row) => expect(row).toHaveLength(m.length));
    // top-left finder pattern: 7 dark modules on the first row
    expect(m[0]!.slice(0, 7).every(Boolean)).toBe(true);
    expect(m[0]![7]).toBe(false);
  });

  it('renders svg and encodes unicode as UTF-8', () => {
    const svg = qrSvg('पनीर ₹', 120);
    expect(svg).toContain('width="120"');
    expect(svg).toContain('<path d="M');
    expect(toUtf8ByteString('₹')).toBe('\xe2\x82\xb9');
  });
});
