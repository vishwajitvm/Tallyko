import type { TableInfo } from '@/api/types';
import { qrSvg } from '@/lib/barcode/qr';
import { printHtml } from '@/lib/print/printers';
import { useData } from '@/store/data';
import { tableOrderUrl } from './common';

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

/** A4 sheet of table tent cards: business name, "Scan to order", QR and table number. Print-only colours (black on white). */
const PAY_HINT: Record<string, string> = {
  counter: 'Pay at the counter',
  upi: 'Pay by UPI from your phone',
  both: 'Pay by UPI or at the counter',
};

export function tableQrHtml(tables: TableInfo[], tenantId: string, businessName: string, paymentMode?: string): string {
  const mode = paymentMode ?? ((useData.getState().settings as { qr_payment_mode?: string } | null)?.qr_payment_mode || 'counter');
  const payHint = PAY_HINT[mode] ?? PAY_HINT.counter;
  const cards = tables.map((t) => {
    const url = tableOrderUrl(tenantId, t.id);
    return `<div class="card">
      <div class="biz">${esc(businessName)}</div>
      <div class="cta">Scan to see the menu &amp; order</div>
      <div class="qr">${qrSvg(url, 190, { ecc: 'M', margin: 2 })}</div>
      <div class="table">Table ${esc(t.table_number)}</div>
      ${t.section ? `<div class="section">${esc(t.section)}</div>` : ''}
      <div class="hint">No app needed · ${esc(payHint)}</div>
    </div>`;
  }).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Table QR codes</title>
<style>
  @page { size: A4; margin: 10mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, 'Segoe UI', Roboto, Arial, sans-serif; margin: 0; color: #000; background: #fff; }
  .grid { display: flex; flex-wrap: wrap; gap: 6mm; justify-content: flex-start; }
  .card { width: 60mm; border: 1.5px dashed #888; border-radius: 4mm; padding: 5mm 3mm; text-align: center; page-break-inside: avoid; break-inside: avoid; }
  .biz { font-size: 13pt; font-weight: 700; line-height: 1.2; word-break: break-word; }
  .cta { font-size: 9pt; margin-top: 1.5mm; color: #333; }
  .qr { margin: 3mm auto 2mm; width: 46mm; height: 46mm; }
  .qr svg { width: 100%; height: 100%; }
  .table { font-size: 22pt; font-weight: 800; letter-spacing: -0.5px; }
  .section { font-size: 9pt; color: #444; margin-top: 0.5mm; }
  .hint { font-size: 7.5pt; color: #555; margin-top: 2mm; }
</style></head><body><div class="grid">${cards}</div></body></html>`;
}

export function printTableQrs(tables: TableInfo[], tenantId: string, businessName: string): Promise<void> {
  return printHtml(tableQrHtml(tables, tenantId, businessName));
}
