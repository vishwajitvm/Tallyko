import { qrSvg } from '@/lib/barcode/qr';
import { escapeHtml } from '@/lib/print/receipt';

/** A4 poster with a big QR code, printed through the system print dialog (counter standee / table tent). */
export function buildQrPosterHtml(opts: { title: string; heading: string; subheading: string; url: string; footer?: string }): string {
  const svg = qrSvg(opts.url, 360, { ecc: 'M', margin: 2 });
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(opts.title)}</title>
<style>
  @page { size: A4; margin: 18mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color: #0f172a; text-align: center; margin: 0; }
  .wrap { border: 2px solid #0f766e; border-radius: 24px; padding: 40px 32px; }
  h1 { font-size: 34px; margin: 0 0 8px; }
  h2 { font-size: 22px; font-weight: 500; margin: 0 0 28px; color: #334155; }
  .qr { display: inline-block; padding: 12px; border: 1px solid #e2e8f0; border-radius: 16px; }
  .url { font-size: 13px; color: #475569; margin-top: 18px; word-break: break-all; }
  .foot { font-size: 12px; color: #64748b; margin-top: 28px; }
</style></head><body><div class="wrap">
  <h1>${escapeHtml(opts.heading)}</h1>
  <h2>${escapeHtml(opts.subheading)}</h2>
  <div class="qr">${svg}</div>
  <div class="url">${escapeHtml(opts.url)}</div>
  ${opts.footer ? `<div class="foot">${escapeHtml(opts.footer)}</div>` : ''}
</div></body></html>`;
}

/** Static UPI QR (no amount: the customer types it). */
export function upiPayUrl(upiId: string, payee: string): string {
  const enc = (s: string) => encodeURIComponent(s).replace(/%40/g, '@');
  return `upi://pay?pa=${enc(upiId.trim())}&pn=${enc(payee.trim() || 'Shop')}&cu=INR`;
}
