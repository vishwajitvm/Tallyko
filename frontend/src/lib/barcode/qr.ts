/**
 * QR code matrix generation (via the pure-JS `qrcode-generator` package) and
 * SVG rendering helpers.
 */
import qrcode from 'qrcode-generator';
import { escapeXml } from './svg';

export type QrErrorCorrection = 'L' | 'M' | 'Q' | 'H';

/** UTF-8 encode, then map each byte to a char so qrcode-generator's default byte mode stores real UTF-8. */
export function toUtf8ByteString(text: string): string {
  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80) out += ch;
    else if (cp < 0x800) out += String.fromCharCode(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000)
      out += String.fromCharCode(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    else
      out += String.fromCharCode(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
  }
  return out;
}

/** Returns the QR module matrix (true = dark), without quiet zone. */
export function qrMatrix(text: string, ecc: QrErrorCorrection = 'M'): boolean[][] {
  const qr = qrcode(0, ecc);
  qr.addData(toUtf8ByteString(text), 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  const rows: boolean[][] = [];
  for (let y = 0; y < n; y++) {
    const row: boolean[] = [];
    for (let x = 0; x < n; x++) row.push(qr.isDark(y, x));
    rows.push(row);
  }
  return rows;
}

/**
 * SVG path data (in module units, offset by `margin`) for the dark modules,
 * merging horizontal runs. Used by both the SVG string and the RN component.
 */
export function qrPath(matrix: boolean[][], margin = 0): string {
  let d = '';
  matrix.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (row[x]) {
        let end = x;
        while (end < row.length && row[end]) end++;
        d += `M${x + margin} ${y + margin}h${end - x}v1h-${end - x}z`;
        x = end;
      } else {
        x++;
      }
    }
  });
  return d;
}

export interface QrSvgOptions {
  ecc?: QrErrorCorrection;
  /** Quiet zone in modules. Default 2 (receipts); use 4 for strict spec compliance. */
  margin?: number;
  color?: string;
  background?: string;
}

/** Returns a standalone `<svg>` string `size`×`size` px for `text`. */
export function qrSvg(text: string, size = 160, opts: QrSvgOptions = {}): string {
  const matrix = qrMatrix(text, opts.ecc ?? 'M');
  const margin = opts.margin ?? 2;
  const dim = matrix.length + margin * 2;
  const color = escapeXml(opts.color ?? '#000');
  const bg = opts.background ?? '#fff';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges" role="img" aria-label="QR code">` +
    (bg !== 'transparent' ? `<rect width="${dim}" height="${dim}" fill="${escapeXml(bg)}"/>` : '') +
    `<path d="${qrPath(matrix, margin)}" fill="${color}"/>` +
    '</svg>'
  );
}
