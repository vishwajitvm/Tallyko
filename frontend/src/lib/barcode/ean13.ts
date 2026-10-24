/**
 * EAN-13 encoder, check digit helpers and in-store (restricted circulation,
 * prefix 20–29) code generator.
 */

const L_CODES = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G_CODES = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const R_CODES = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
/** Left-half parity per leading digit (L = odd, G = even). */
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLG', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

export interface Ean13Encoding {
  /** Full 13-digit code including check digit. */
  value: string;
  /** 95 modules as '1' (bar) / '0' (space). */
  bits: string;
  /** Module index ranges [start, end) of the guard bars (start, centre, end) - drawn taller. */
  guards: [number, number][];
  totalModules: 95;
}

/** Computes the EAN-13 check digit for a 12-digit body. */
export function ean13CheckDigit(body12: string): number {
  if (!/^\d{12}$/.test(body12)) throw new RangeError('EAN-13: body must be exactly 12 digits');
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(body12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

export function isValidEan13(code: string): boolean {
  if (!/^\d{13}$/.test(code)) return false;
  return ean13CheckDigit(code.slice(0, 12)) === Number(code[12]);
}

/** Accepts 12 digits (check digit appended) or 13 digits (check digit verified). */
export function normalizeEan13(input: string): string {
  const digits = input.trim();
  if (/^\d{12}$/.test(digits)) return digits + String(ean13CheckDigit(digits));
  if (/^\d{13}$/.test(digits)) {
    if (!isValidEan13(digits)) throw new RangeError(`EAN-13: invalid check digit in ${digits}`);
    return digits;
  }
  throw new RangeError('EAN-13: value must be 12 or 13 digits');
}

export function encodeEan13(input: string): Ean13Encoding {
  const value = normalizeEan13(input);
  const parity = PARITY[Number(value[0])]!;
  let bits = '101';
  for (let i = 1; i <= 6; i++) {
    const d = Number(value[i]);
    bits += parity[i - 1] === 'L' ? L_CODES[d] : G_CODES[d];
  }
  bits += '01010';
  for (let i = 7; i <= 12; i++) bits += R_CODES[Number(value[i])];
  bits += '101';
  return { value, bits, guards: [[0, 3], [45, 50], [92, 95]], totalModules: 95 };
}

/**
 * Generates an in-store EAN-13 (GS1 restricted circulation range 20–29) for
 * items without a manufacturer barcode: `prefix` + zero-padded `seq` + check digit.
 *
 * makeInternalEan13(42) → "2000000000428" (prefix "2" → codes in the 20 range)
 */
export function makeInternalEan13(seq: number, prefix = '2'): string {
  if (!/^2\d{0,10}$/.test(prefix)) {
    throw new RangeError('EAN-13: in-store prefix must start with 2 (range 20-29) and be at most 11 digits');
  }
  if (!Number.isSafeInteger(seq) || seq < 0) throw new RangeError('EAN-13: seq must be a non-negative integer');
  const room = 12 - prefix.length;
  const seqStr = String(seq);
  if (seqStr.length > room) throw new RangeError(`EAN-13: seq ${seq} does not fit in ${room} digits after prefix ${prefix}`);
  const body = prefix + seqStr.padStart(room, '0');
  return body + String(ean13CheckDigit(body));
}
