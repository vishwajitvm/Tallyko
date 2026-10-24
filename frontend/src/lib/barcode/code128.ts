/**
 * Code 128 encoder (code sets B and C, auto-selected) with mod-103 check digit.
 *
 * Output is expressed as module widths (bar, space, bar, space, ...), always
 * starting with a bar, so it can be rendered as SVG / react-native-svg / canvas.
 */

/** Element widths for symbol values 0..106 (106 = STOP, 7 elements). */
export const CODE128_PATTERNS: readonly string[] = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

export const CODE128_START_B = 104;
export const CODE128_START_C = 105;
export const CODE128_STOP = 106;
/** "Code C" switch value when currently in set B. */
const SWITCH_TO_C = 99;
/** "Code B" switch value when currently in set C. */
const SWITCH_TO_B = 100;

export type Code128Set = 'B' | 'C';

/** A run of the input encoded in a single code set. For set C, `data` has even length. */
export interface Code128Segment {
  set: Code128Set;
  data: string;
}

export interface Code128Encoding {
  /** Symbol values including start, data, switches and check digit (excluding STOP). */
  values: number[];
  checkDigit: number;
  /** Module widths, starting with a bar, alternating bar/space, including STOP. */
  widths: number[];
  /** Same pattern as a '1' (bar) / '0' (space) string, one char per module. */
  bits: string;
  /** Total width in modules, excluding quiet zones (11 * symbols + 13). */
  totalModules: number;
  segments: Code128Segment[];
}

const isDigit = (c: string | undefined): boolean => c !== undefined && c >= '0' && c <= '9';

function digitRun(value: string, from: number): number {
  let i = from;
  while (i < value.length && isDigit(value[i])) i++;
  return i - from;
}

/** Throws RangeError if `value` contains characters that set B cannot encode (ASCII 32..126). */
export function assertCode128Encodable(value: string): void {
  if (value.length === 0) throw new RangeError('Code 128: value must not be empty');
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 32 || code > 126) {
      throw new RangeError(`Code 128: unsupported character at position ${i} (code ${code})`);
    }
  }
}

export function isCode128Encodable(value: string): boolean {
  try {
    assertCode128Encodable(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Splits the value into code-set segments, choosing set C for digit runs where it
 * saves space (≥4 digits at the start/end, ≥6 digits in the middle), else set B.
 */
export function code128Segments(value: string): Code128Segment[] {
  assertCode128Encodable(value);
  const segments: Code128Segment[] = [];
  const push = (set: Code128Set, chunk: string) => {
    const last = segments[segments.length - 1];
    if (last && last.set === set) last.data += chunk;
    else segments.push({ set, data: chunk });
  };

  let i = 0;
  const len = value.length;
  const leading = digitRun(value, 0);
  let set: Code128Set = leading >= 4 || (leading === len && leading % 2 === 0) ? 'C' : 'B';

  while (i < len) {
    if (set === 'C') {
      if (digitRun(value, i) >= 2) {
        push('C', value.slice(i, i + 2));
        i += 2;
      } else {
        set = 'B';
      }
      continue;
    }
    const run = digitRun(value, i);
    const reachesEnd = i + run === len;
    if ((reachesEnd && run >= 4) || run >= 6) {
      if (run % 2 === 1) {
        push('B', value[i]!);
        i += 1;
      }
      set = 'C';
      continue;
    }
    push('B', value[i]!);
    i += 1;
  }
  return segments;
}

/** Encodes `value` as Code 128 (auto B/C). Throws RangeError for unsupported input. */
export function encodeCode128(value: string): Code128Encoding {
  const segments = code128Segments(value);
  const values: number[] = [];
  segments.forEach((seg, idx) => {
    if (idx === 0) values.push(seg.set === 'C' ? CODE128_START_C : CODE128_START_B);
    else values.push(seg.set === 'C' ? SWITCH_TO_C : SWITCH_TO_B);
    if (seg.set === 'C') {
      for (let j = 0; j < seg.data.length; j += 2) values.push(Number(seg.data.slice(j, j + 2)));
    } else {
      for (const ch of seg.data) values.push(ch.charCodeAt(0) - 32);
    }
  });

  let sum = values[0]!;
  for (let k = 1; k < values.length; k++) sum += values[k]! * k;
  const checkDigit = sum % 103;
  values.push(checkDigit);

  const widths: number[] = [];
  for (const v of [...values, CODE128_STOP]) {
    for (const ch of CODE128_PATTERNS[v]!) widths.push(Number(ch));
  }
  let bits = '';
  widths.forEach((w, idx) => {
    bits += (idx % 2 === 0 ? '1' : '0').repeat(w);
  });
  return { values, checkDigit, widths, bits, totalModules: bits.length, segments };
}
