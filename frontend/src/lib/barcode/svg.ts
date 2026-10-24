/**
 * Barcode geometry + standalone SVG string rendering (for HTML receipts / labels).
 * The same geometry is used by the react-native-svg <Barcode/> component.
 */
import { encodeCode128 } from './code128';
import { encodeEan13 } from './ean13';

export type BarcodeFormat = 'code128' | 'ean13';

export interface BarcodeOptions {
  format?: BarcodeFormat;
  /** Bar height in px (excluding text). Default 50. */
  height?: number;
  /** Width of one module in px. Default 2. */
  moduleWidth?: number;
  /** Print the human-readable value below the bars. Default true. */
  showText?: boolean;
  /** Quiet zone on each side, in modules. Default 10 (Code 128) / 9 (EAN-13). */
  quietZone?: number;
  color?: string;
  background?: string;
  fontSize?: number;
}

export interface BarRect {
  /** x offset in modules (excluding quiet zone). */
  x: number;
  /** width in modules. */
  w: number;
  /** guard bar (EAN-13) - drawn taller, into the text area. */
  guard: boolean;
}

export interface BarcodeGeometry {
  format: BarcodeFormat;
  /** Encoded value (EAN-13: with check digit). */
  value: string;
  bars: BarRect[];
  totalModules: number;
  /** Human-readable text groups: x (modules, centre of text) + text. */
  text: { x: number; text: string; anchor: 'middle' | 'end' }[];
}

function bitsToBars(bits: string, guards: [number, number][] = []): BarRect[] {
  const bars: BarRect[] = [];
  let i = 0;
  while (i < bits.length) {
    if (bits[i] === '1') {
      let j = i;
      while (j < bits.length && bits[j] === '1') j++;
      const guard = guards.some(([s, e]) => i >= s && i < e);
      bars.push({ x: i, w: j - i, guard });
      i = j;
    } else {
      i++;
    }
  }
  return bars;
}

/** Computes bar rectangles for a value. Throws RangeError if the value can't be encoded. */
export function barcodeGeometry(value: string, format: BarcodeFormat = 'code128'): BarcodeGeometry {
  if (format === 'ean13') {
    const enc = encodeEan13(value);
    const v = enc.value;
    return {
      format,
      value: v,
      bars: bitsToBars(enc.bits, enc.guards),
      totalModules: enc.totalModules,
      text: [
        { x: -2, text: v[0]!, anchor: 'end' },
        { x: 3 + 21, text: v.slice(1, 7), anchor: 'middle' },
        { x: 50 + 21, text: v.slice(7), anchor: 'middle' },
      ],
    };
  }
  const enc = encodeCode128(value);
  return {
    format,
    value,
    bars: bitsToBars(enc.bits),
    totalModules: enc.totalModules,
    text: [{ x: enc.totalModules / 2, text: value, anchor: 'middle' }],
  };
}

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const r = (n: number) => Math.round(n * 100) / 100;

/** Resolved layout in px for a geometry + options (shared by SVG string and RN component). */
export function barcodeLayout(geom: BarcodeGeometry, opts: BarcodeOptions = {}) {
  const moduleWidth = opts.moduleWidth ?? 2;
  const height = opts.height ?? 50;
  const showText = opts.showText ?? true;
  const quiet = opts.quietZone ?? (geom.format === 'ean13' ? 9 : 10);
  const fontSize = opts.fontSize ?? Math.max(10, Math.round(moduleWidth * 7));
  const textGap = showText ? fontSize + 4 : 0;
  const guardExtra = geom.format === 'ean13' && showText ? Math.round(fontSize / 2) : 0;
  const width = (geom.totalModules + quiet * 2) * moduleWidth;
  const totalHeight = height + textGap;
  return {
    width,
    totalHeight,
    rects: geom.bars.map((b) => ({
      x: r((b.x + quiet) * moduleWidth),
      y: 0,
      w: r(b.w * moduleWidth),
      h: b.guard ? height + guardExtra : height,
    })),
    texts: showText
      ? geom.text.map((t) => ({
          x: r((t.x + quiet) * moduleWidth),
          y: height + fontSize + 1,
          text: t.text,
          anchor: t.anchor,
        }))
      : [],
    fontSize,
  };
}

/** Returns a standalone `<svg>` string for the barcode. Throws RangeError for invalid values. */
export function barcodeSvg(value: string, opts: BarcodeOptions = {}): string {
  const geom = barcodeGeometry(value, opts.format ?? 'code128');
  const lay = barcodeLayout(geom, opts);
  const color = escapeXml(opts.color ?? '#000');
  const bg = opts.background ?? '#fff';
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${lay.width}" height="${lay.totalHeight}" viewBox="0 0 ${lay.width} ${lay.totalHeight}" shape-rendering="crispEdges" role="img" aria-label="${escapeXml(geom.value)}">`,
  );
  if (bg !== 'transparent') parts.push(`<rect width="100%" height="100%" fill="${escapeXml(bg)}"/>`);
  // One path for all bars keeps the markup compact.
  const d = lay.rects.map((b) => `M${b.x} ${b.y}h${b.w}v${b.h}h-${b.w}z`).join('');
  parts.push(`<path d="${d}" fill="${color}"/>`);
  for (const t of lay.texts) {
    parts.push(
      `<text x="${t.x}" y="${t.y}" font-family="monospace" font-size="${lay.fontSize}" text-anchor="${t.anchor}" fill="${color}">${escapeXml(t.text)}</text>`,
    );
  }
  parts.push('</svg>');
  return parts.join('');
}
