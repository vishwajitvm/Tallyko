/**
 * Printable barcode label sheets (HTML) for products: A4 sticker sheets or thermal label rolls.
 */
import { barcodeSvg, escapeXml, type BarcodeFormat } from '@/lib/barcode/svg';
import { isValidEan13 } from '@/lib/barcode/ean13';
import { isCode128Encodable } from '@/lib/barcode/code128';
import { money } from '@/lib/format';

export type LabelLayout = 'a4-24' | 'a4-40' | 'roll-50x25' | 'roll-38x25';

export const LABEL_LAYOUTS: { value: LabelLayout; label: string; hint: string }[] = [
  { value: 'a4-24', label: 'A4 · 24 per sheet', hint: '3 × 8 stickers (64 × 34 mm), any office printer' },
  { value: 'a4-40', label: 'A4 · 40 per sheet', hint: '4 × 10 stickers (48 × 25 mm)' },
  { value: 'roll-50x25', label: 'Label roll 50 × 25 mm', hint: 'Thermal label printer, one label per page' },
  { value: 'roll-38x25', label: 'Label roll 38 × 25 mm', hint: 'Small thermal labels' },
];

export interface LabelItem { name: string; price: number | null; barcode: string; copies: number; variant?: string | null }

export function barcodeFormatFor(code: string): BarcodeFormat | null {
  const t = code.trim();
  if (isValidEan13(t)) return 'ean13';
  if (isCode128Encodable(t)) return 'code128';
  return null;
}

export function buildLabelsHtml(items: LabelItem[], opts: { layout: LabelLayout; symbol: string; businessName?: string | null; showPrice: boolean }): string {
  const { layout, symbol, businessName, showPrice } = opts;
  const roll = layout.startsWith('roll');
  const dims = {
    'a4-24': { w: 63.5, h: 33.9, cols: 3 },
    'a4-40': { w: 48.5, h: 25.4, cols: 4 },
    'roll-50x25': { w: 50, h: 25, cols: 1 },
    'roll-38x25': { w: 38, h: 25, cols: 1 },
  }[layout];
  const small = dims.h <= 25.5;

  const labels: string[] = [];
  for (const item of items) {
    const format = barcodeFormatFor(item.barcode);
    if (!format) continue;
    let svg = '';
    try {
      svg = barcodeSvg(item.barcode, { format, height: 40, moduleWidth: 2, fontSize: 14 });
    } catch {
      continue;
    }
    const name = escapeXml(item.variant ? `${item.name} (${item.variant})` : item.name);
    const price = showPrice && item.price !== null ? `<div class="price">${escapeXml(money(item.price, symbol))}</div>` : '';
    const shop = businessName && !small ? `<div class="shop">${escapeXml(businessName)}</div>` : '';
    const html = `<div class="label">${shop}<div class="row"><div class="name">${name}</div>${price}</div><div class="code">${svg}</div></div>`;
    for (let i = 0; i < Math.max(1, Math.min(item.copies, 500)); i++) labels.push(html);
  }

  const page = roll
    ? `@page { size: ${dims.w}mm ${dims.h}mm; margin: 0; }
       .sheet { display: block; }
       .label { width: ${dims.w}mm; height: ${dims.h}mm; page-break-after: always; break-after: page; }
       .label:last-child { page-break-after: auto; break-after: auto; }`
    : `@page { size: A4; margin: 10mm 7mm; }
       .sheet { display: grid; grid-template-columns: repeat(${dims.cols}, ${dims.w}mm); grid-auto-rows: ${dims.h}mm; gap: 0 2.5mm; }
       .label { width: ${dims.w}mm; height: ${dims.h}mm; outline: 0.1mm dashed #ddd; }`;

  return `<!doctype html><html><head><meta charset="utf-8"><title>Barcode labels</title><style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { background: #fff; color: #000; font-family: -apple-system, 'Segoe UI', Roboto, Arial, sans-serif; }
    ${page}
    .label { overflow: hidden; padding: ${small ? '1.2mm 1.5mm' : '2mm 2.5mm'}; display: flex; flex-direction: column; justify-content: space-between; break-inside: avoid; page-break-inside: avoid; }
    .shop { font-size: 6.5pt; color: #444; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .row { display: flex; align-items: flex-start; gap: 1.5mm; }
    .name { flex: 1; font-size: ${small ? '6.5pt' : '8pt'}; font-weight: 600; line-height: 1.15; max-height: 2.3em; overflow: hidden; }
    .price { font-size: ${small ? '8pt' : '10pt'}; font-weight: 800; white-space: nowrap; }
    .code { flex: 1; min-height: 0; display: flex; align-items: flex-end; justify-content: center; }
    .code svg { max-width: 100%; max-height: 100%; width: auto; height: ${small ? '13mm' : '17mm'}; }
    @media screen { body { padding: 12px; } }
  </style></head><body><div class="sheet">${labels.join('')}</div></body></html>`;
}

export function countLabels(items: LabelItem[]): number {
  return items.reduce((n, i) => n + (barcodeFormatFor(i.barcode) ? Math.max(1, i.copies) : 0), 0);
}
