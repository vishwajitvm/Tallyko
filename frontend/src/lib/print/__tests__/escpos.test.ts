/// <reference types="jest" />
import { EscPos, toAscii, transliterateDevanagari } from '../escpos';

const arr = (u: Uint8Array) => Array.from(u);

/** Index of `needle` inside `hay`, or -1. */
function indexOfSeq(hay: number[], needle: number[]): number {
  outer: for (let i = 0; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

describe('EscPos builder', () => {
  it('emits basic command bytes', () => {
    expect(arr(new EscPos().init().build())).toEqual([0x1b, 0x40]);
    expect(arr(new EscPos().cut().build())).toEqual([0x1d, 0x56, 0x42, 0x00]);
    expect(arr(new EscPos().cut(false).build())).toEqual([0x1d, 0x56, 0x41, 0x00]);
    expect(arr(new EscPos().align('center').build())).toEqual([0x1b, 0x61, 0x01]);
    expect(arr(new EscPos().bold().bold(false).build())).toEqual([0x1b, 0x45, 1, 0x1b, 0x45, 0]);
    expect(arr(new EscPos().doubleSize().doubleSize(false).build())).toEqual([0x1d, 0x21, 0x11, 0x1d, 0x21, 0x00]);
    expect(arr(new EscPos().doubleHeight().build())).toEqual([0x1d, 0x21, 0x01]);
    expect(arr(new EscPos().feed(3).build())).toEqual([0x1b, 0x64, 3]);
    expect(arr(new EscPos().drawerKick().build())).toEqual([0x1b, 0x70, 0, 25, 250]);
  });

  it('writes sanitised text with LF', () => {
    expect(arr(new EscPos().line('₹5').build())).toEqual([...'Rs.5'].map((c) => c.charCodeAt(0)).concat(0x0a));
  });

  it('builds CODE128 barcode with {B prefix (GS k 73)', () => {
    const bytes = arr(new EscPos().barcode128('TALLYKO-123', { height: 50, moduleWidth: 2 }).build());
    const data = [0x7b, 0x42, ...[...'TALLYKO-123'].map((c) => c.charCodeAt(0))];
    expect(bytes).toEqual([
      0x1d, 0x68, 50, // GS h
      0x1d, 0x77, 2, // GS w
      0x1d, 0x48, 2, // GS H (HRI below)
      0x1d, 0x66, 0, // GS f
      0x1d, 0x6b, 73, data.length, ...data,
    ]);
  });

  it('builds CODE128 barcode with {C for numeric data and escapes "{"', () => {
    const bytes = arr(new EscPos().barcode128('12345678').build());
    expect(bytes.slice(-10)).toEqual([0x1d, 0x6b, 73, 6, 0x7b, 0x43, 12, 34, 56, 78]);
    expect(EscPos.code128Data('A{1')).toEqual([0x7b, 0x42, 0x41, 0x7b, 0x7b, 0x31]);
    expect(EscPos.code128Data('INV1234')).toEqual([0x7b, 0x42, 0x49, 0x4e, 0x56, 0x7b, 0x43, 12, 34]);
  });

  it('builds a native QR (GS ( k) sequence', () => {
    const bytes = arr(new EscPos().qr('ABC', { size: 5, ecc: 'M' }).build());
    expect(bytes).toEqual([
      0x1d, 0x28, 0x6b, 4, 0, 0x31, 0x41, 0x32, 0,
      0x1d, 0x28, 0x6b, 3, 0, 0x31, 0x43, 5,
      0x1d, 0x28, 0x6b, 3, 0, 0x31, 0x45, 49,
      0x1d, 0x28, 0x6b, 6, 0, 0x31, 0x50, 0x30, 0x41, 0x42, 0x43,
      0x1d, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30,
    ]);
  });

  it('handles long QR payload lengths (pL/pH)', () => {
    const bytes = arr(new EscPos().qr('x'.repeat(300)).build());
    expect(indexOfSeq(bytes, [0x1d, 0x28, 0x6b, (303 & 0xff), 303 >> 8, 0x31, 0x50, 0x30])).toBeGreaterThan(0);
  });
});

describe('toAscii', () => {
  it('replaces rupee and typographic symbols', () => {
    expect(toAscii('₹1,250')).toBe('Rs.1,250');
    expect(toAscii('“Chef’s” special – hot…')).toBe('"Chef\'s" special - hot...');
    expect(toAscii('Café Crème Brûlée')).toBe('Cafe Creme Brulee');
  });

  it('transliterates Devanagari menu names', () => {
    expect(toAscii('पनीर टिक्का')).toBe('Paneer Tikka');
    expect(toAscii('दाल')).toBe('Dal');
    expect(transliterateDevanagari('चाय')).toBe('chay');
    expect(toAscii('Masala चाय (२)')).toBe('Masala Chay (2)');
  });

  it('replaces other scripts / emoji with a single ?', () => {
    expect(toAscii('இட்லி')).toBe('?');
    expect(toAscii('Pizza 🍕!')).toBe('Pizza ?!');
    expect(toAscii('a​b\u0007c')).toBe('abc');
    expect(toAscii(null)).toBe('');
  });

  it('never outputs non-ASCII', () => {
    const s = toAscii('ঢাকা 北京 Ñandú ₹ 😀 ज़ायका');
    expect(/^[\x20-\x7e\n]*$/.test(s)).toBe(true);
  });
});
