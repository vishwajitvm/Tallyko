/**
 * ESC/POS command builder for 58/80mm thermal printers (Epson-compatible command set
 * used by PT-210, MTP-II, Rugtek, Xprinter, TVS, etc.).
 *
 * Text is always reduced to printable ASCII (see `toAscii`) because most cheap printers
 * only ship code page PC437 and have no ₹ glyph or Indic fonts.
 */
import { code128Segments } from '@/lib/barcode/code128';

export const ESC = 0x1b;
export const GS = 0x1d;
export const LF = 0x0a;

export type Align = 'left' | 'center' | 'right';
export type QrEcc = 'L' | 'M' | 'Q' | 'H';

// ---------------------------------------------------------------------------
// Text sanitising / transliteration
// ---------------------------------------------------------------------------

const SYMBOL_MAP: Record<string, string> = {
  '₹': 'Rs.', // ₹
  '‘': "'", '’': "'", '‚': "'", '‛': "'", '′': "'", '´': "'", '`': '`',
  '“': '"', '”': '"', '„': '"', '″': '"', '«': '"', '»': '"',
  '‐': '-', '‑': '-', '‒': '-', '–': '-', '—': '-', '―': '-', '−': '-',
  '…': '...', '•': '*', '·': '.', '×': 'x', '÷': '/',
  ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', '　': ' ',
  '½': '1/2', '¼': '1/4', '¾': '3/4', '°': 'deg', '™': 'TM', '©': '(C)', '®': '(R)',
  '€': 'EUR', '£': 'GBP', '¥': 'JPY', 'ß': 'ss', 'æ': 'ae', 'Æ': 'AE', 'ø': 'o', 'Ø': 'O',
  '।': '.', '॥': '.', 'ॐ': 'Om',
};

/** Zero-width / formatting characters dropped silently. */
const DROP = /[​-‍⁠﻿︀-️]/;

const DEV_VOWELS: Record<number, string> = {
  0x0904: 'e', 0x0905: 'a', 0x0906: 'a', 0x0907: 'i', 0x0908: 'ee', 0x0909: 'u', 0x090a: 'oo', 0x090b: 'ri',
  0x090d: 'e', 0x090e: 'e', 0x090f: 'e', 0x0910: 'ai', 0x0911: 'o', 0x0912: 'o', 0x0913: 'o', 0x0914: 'au',
};
const DEV_MATRAS: Record<number, string> = {
  0x093e: 'a', 0x093f: 'i', 0x0940: 'ee', 0x0941: 'u', 0x0942: 'oo', 0x0943: 'ri', 0x0945: 'e', 0x0946: 'e',
  0x0947: 'e', 0x0948: 'ai', 0x0949: 'o', 0x094a: 'o', 0x094b: 'o', 0x094c: 'au',
};
const DEV_CONSONANTS: Record<number, string> = {
  0x0915: 'k', 0x0916: 'kh', 0x0917: 'g', 0x0918: 'gh', 0x0919: 'n', 0x091a: 'ch', 0x091b: 'chh', 0x091c: 'j',
  0x091d: 'jh', 0x091e: 'n', 0x091f: 't', 0x0920: 'th', 0x0921: 'd', 0x0922: 'dh', 0x0923: 'n', 0x0924: 't',
  0x0925: 'th', 0x0926: 'd', 0x0927: 'dh', 0x0928: 'n', 0x0929: 'n', 0x092a: 'p', 0x092b: 'ph', 0x092c: 'b',
  0x092d: 'bh', 0x092e: 'm', 0x092f: 'y', 0x0930: 'r', 0x0931: 'r', 0x0932: 'l', 0x0933: 'l', 0x0934: 'l',
  0x0935: 'v', 0x0936: 'sh', 0x0937: 'sh', 0x0938: 's', 0x0939: 'h',
  0x0958: 'q', 0x0959: 'kh', 0x095a: 'g', 0x095b: 'z', 0x095c: 'r', 0x095d: 'rh', 0x095e: 'f', 0x095f: 'y',
};
const NUKTA_MAP: Record<string, string> = { k: 'q', j: 'z', ph: 'f', d: 'r', dh: 'rh', g: 'g', kh: 'kh' };

const isDevanagari = (cp: number) => cp >= 0x0900 && cp <= 0x097f;

/** Simple phonetic Devanagari → Latin (Hindi/Marathi menu names): "पनीर टिक्का" → "Paneer Tikka". */
export function transliterateDevanagari(input: string): string {
  let out = '';
  let pending: string | null = null; // consonant awaiting vowel
  let wordHasOutput = false;

  const flush = (wordEnd: boolean) => {
    if (pending === null) return;
    // Schwa deletion at the end of a word (only if something precedes it).
    out += wordEnd && wordHasOutput ? pending : pending + 'a';
    pending = null;
    wordHasOutput = true;
  };

  for (const ch of input) {
    const cp = ch.codePointAt(0)!;
    if (!isDevanagari(cp)) {
      flush(true);
      wordHasOutput = false;
      out += ch;
      continue;
    }
    if (DEV_CONSONANTS[cp] !== undefined) {
      flush(false);
      pending = DEV_CONSONANTS[cp]!;
    } else if (cp === 0x093c) {
      // nukta
      if (pending !== null) pending = NUKTA_MAP[pending] ?? pending;
    } else if (DEV_MATRAS[cp] !== undefined) {
      out += (pending ?? '') + DEV_MATRAS[cp];
      pending = null;
      wordHasOutput = true;
    } else if (cp === 0x094d) {
      // virama: dead consonant
      if (pending !== null) out += pending;
      pending = null;
      wordHasOutput = true;
    } else if (DEV_VOWELS[cp] !== undefined) {
      flush(false);
      out += DEV_VOWELS[cp];
      wordHasOutput = true;
    } else if (cp === 0x0901 || cp === 0x0902) {
      flush(false);
      out += 'n';
      wordHasOutput = true;
    } else if (cp === 0x0903) {
      flush(false);
      out += 'h';
      wordHasOutput = true;
    } else if (cp >= 0x0966 && cp <= 0x096f) {
      flush(true);
      wordHasOutput = false;
      out += String(cp - 0x0966);
    } else if (SYMBOL_MAP[ch] !== undefined) {
      flush(true);
      wordHasOutput = false;
      out += SYMBOL_MAP[ch];
    }
    // other marks (accents, stress signs) are dropped
  }
  flush(true);
  return out;
}

/**
 * Reduces any string to printable ASCII for thermal printers:
 * ₹ → "Rs.", smart quotes/dashes → ASCII, accents stripped, Devanagari transliterated,
 * other scripts/emoji → "?" (one per run). Newlines are kept; other control chars removed.
 */
export function toAscii(input: string | null | undefined): string {
  if (!input) return '';
  let s = String(input);
  if (/[ऀ-ॿ]/.test(s)) {
    // Transliterate Devanagari words and capitalise each transliterated word.
    s = s.replace(/[ऀ-ॿ]+/g, (run) => {
      const t = transliterateDevanagari(run);
      return t.charAt(0).toUpperCase() + t.slice(1);
    });
  }
  let out = '';
  let lastUnknown = false;
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (ch === '\n') {
      out += ch;
      lastUnknown = false;
    } else if (ch === '\t') {
      out += ' ';
      lastUnknown = false;
    } else if (cp >= 0x20 && cp < 0x7f) {
      out += ch;
      lastUnknown = false;
    } else if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0) || DROP.test(ch)) {
      // control / zero-width: drop
    } else if (SYMBOL_MAP[ch] !== undefined) {
      out += SYMBOL_MAP[ch];
      lastUnknown = false;
    } else {
      let base = '';
      if (cp < 0x0250 || (cp >= 0x1e00 && cp <= 0x1eff)) {
        try {
          base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
        } catch {
          base = '';
        }
      }
      if (base && /^[\x20-\x7e]+$/.test(base)) {
        out += base;
        lastUnknown = false;
      } else if (/^[̀-ͯ]$/.test(ch)) {
        // stray combining mark: drop
      } else if (!lastUnknown) {
        out += '?';
        lastUnknown = true;
      }
    }
  }
  return out;
}

/** ASCII string → bytes (assumes already sanitised; anything else becomes '?'). */
export function asciiBytes(s: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    bytes.push(c < 0x80 ? c : 0x3f);
  }
  return bytes;
}

function utf8Bytes(s: string): number[] {
  const out: number[] = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
  }
  return out;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(n)));

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export interface Barcode128Options {
  /** Bar height in dots (1-255). Default 60. */
  height?: number;
  /** Module width in dots (2-6 on most printers; 1 accepted by some). Default 2. */
  moduleWidth?: number;
  /** Human-readable text position. Default 'below'. */
  hri?: 'none' | 'above' | 'below' | 'both';
}

export interface QrOptions {
  /** Module size in dots (1-16). Default 6. */
  size?: number;
  ecc?: QrEcc;
}

export class EscPos {
  private bytes: number[] = [];

  /** ESC @ — reset printer to defaults. */
  init(): this {
    return this.raw([ESC, 0x40]);
  }

  /** ESC t n — select character code table (0 = PC437). */
  codePage(n: number): this {
    return this.raw([ESC, 0x74, clamp(n, 0, 255)]);
  }

  /** ESC a n */
  align(a: Align): this {
    return this.raw([ESC, 0x61, a === 'center' ? 1 : a === 'right' ? 2 : 0]);
  }

  /** ESC E n */
  bold(on = true): this {
    return this.raw([ESC, 0x45, on ? 1 : 0]);
  }

  /** ESC - n */
  underline(on = true): this {
    return this.raw([ESC, 0x2d, on ? 1 : 0]);
  }

  /** ESC M n — font A (12x24, 32/48 cols) or B (9x17, 42/64 cols). */
  font(f: 'A' | 'B'): this {
    return this.raw([ESC, 0x4d, f === 'B' ? 1 : 0]);
  }

  /** GS B n — white-on-black. */
  invert(on = true): this {
    return this.raw([GS, 0x42, on ? 1 : 0]);
  }

  /** GS ! n — character size multipliers 1..8. */
  size(width: number, height: number): this {
    const w = clamp(width, 1, 8) - 1;
    const h = clamp(height, 1, 8) - 1;
    return this.raw([GS, 0x21, (w << 4) | h]);
  }

  /** Double width + height (or back to normal). */
  doubleSize(on = true): this {
    return on ? this.size(2, 2) : this.size(1, 1);
  }

  /** Double height only (keeps chars-per-line). */
  doubleHeight(on = true): this {
    return on ? this.size(1, 2) : this.size(1, 1);
  }

  /** Writes text (sanitised to ASCII, ₹ → "Rs.") without a newline. */
  text(s: string): this {
    return this.raw(asciiBytes(toAscii(s)));
  }

  /** Writes text followed by LF. */
  line(s = ''): this {
    return this.text(s).raw([LF]);
  }

  newline(n = 1): this {
    for (let i = 0; i < n; i++) this.bytes.push(LF);
    return this;
  }

  /** ESC d n — print and feed n lines. */
  feed(n = 1): this {
    return this.raw([ESC, 0x64, clamp(n, 0, 255)]);
  }

  /** Horizontal rule of `width` chars. */
  rule(width: number, ch = '-'): this {
    return this.line(ch.repeat(width));
  }

  /**
   * GS V m n (function B) — feed to the cutter position and cut.
   * Printers without a cutter ignore it.
   */
  cut(partial = true, feedDots = 0): this {
    return this.raw([GS, 0x56, partial ? 0x42 : 0x41, clamp(feedDots, 0, 255)]);
  }

  /** ESC p m t1 t2 — cash drawer kick pulse on pin 2 (0) or pin 5 (1). Times in ms. */
  drawerKick(pin: 0 | 1 = 0, onMs = 50, offMs = 500): this {
    return this.raw([ESC, 0x70, pin, clamp(onMs / 2, 1, 255), clamp(offMs / 2, 1, 255)]);
  }

  /** Data bytes for GS k 73 (CODE128) with `{B`/`{C` code-set prefixes. */
  static code128Data(value: string): number[] {
    const data: number[] = [];
    for (const seg of code128Segments(value)) {
      data.push(0x7b, seg.set === 'C' ? 0x43 : 0x42); // "{C" / "{B"
      if (seg.set === 'C') {
        for (let i = 0; i < seg.data.length; i += 2) data.push(Number(seg.data.slice(i, i + 2)));
      } else {
        for (const ch of seg.data) {
          const c = ch.charCodeAt(0);
          if (c === 0x7b) data.push(0x7b, 0x7b); // literal "{" is escaped as "{{"
          else data.push(c);
        }
      }
    }
    return data;
  }

  /** Native CODE128 barcode: GS h, GS w, GS H, GS f, then GS k 73 n {B…/{C…. */
  barcode128(value: string, opts: Barcode128Options = {}): this {
    const data = EscPos.code128Data(value);
    if (data.length > 255) throw new RangeError('Code 128 value too long for printer barcode');
    const hri = { none: 0, above: 1, below: 2, both: 3 }[opts.hri ?? 'below'];
    this.raw([GS, 0x68, clamp(opts.height ?? 60, 1, 255)]);
    this.raw([GS, 0x77, clamp(opts.moduleWidth ?? 2, 1, 6)]);
    this.raw([GS, 0x48, hri]);
    this.raw([GS, 0x66, 0]);
    return this.raw([GS, 0x6b, 73, data.length, ...data]);
  }

  /** Native QR code via GS ( k (model 2): model, size, ECC, store, print. */
  qr(data: string, opts: QrOptions = {}): this {
    const payload = utf8Bytes(data);
    if (payload.length > 7089) throw new RangeError('QR data too long');
    const ecc = { L: 48, M: 49, Q: 50, H: 51 }[opts.ecc ?? 'M'];
    const storeLen = payload.length + 3;
    this.raw([GS, 0x28, 0x6b, 4, 0, 0x31, 0x41, 0x32, 0x00]); // model 2
    this.raw([GS, 0x28, 0x6b, 3, 0, 0x31, 0x43, clamp(opts.size ?? 6, 1, 16)]); // module size
    this.raw([GS, 0x28, 0x6b, 3, 0, 0x31, 0x45, ecc]); // error correction
    this.raw([GS, 0x28, 0x6b, storeLen & 0xff, (storeLen >> 8) & 0xff, 0x31, 0x50, 0x30, ...payload]); // store
    return this.raw([GS, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30]); // print
  }

  raw(bytes: ArrayLike<number>): this {
    for (let i = 0; i < bytes.length; i++) this.bytes.push(bytes[i]! & 0xff);
    return this;
  }

  get length(): number {
    return this.bytes.length;
  }

  build(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}
