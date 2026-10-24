/**
 * Receipt (GST tax invoice / bill of supply) and KOT layouts, rendered to:
 *  - ESC/POS bytes (thermal printers over Bluetooth/BLE/Web Bluetooth),
 *  - plain text (same layout as ESC/POS, for previews/tests),
 *  - standalone HTML (system print dialog / AirPrint / USB printers installed in the OS).
 */
import { isCode128Encodable, encodeCode128 } from '@/lib/barcode/code128';
import { qrSvg } from '@/lib/barcode/qr';
import { barcodeSvg } from '@/lib/barcode/svg';
import { EscPos, toAscii, type Align } from './escpos';

export interface ReceiptBusiness {
  name: string;
  address?: string | null;
  phone?: string | null;
  gstin?: string | null;
  fssai?: string | null;
  footer?: string | null;
  currencySymbol: string;
  upiId?: string | null;
}

export interface ReceiptItem {
  name: string;
  variant?: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  taxRate: number;
  /** Added free by an offer (printed as FREE). */
  free?: boolean;
  /** On the house: printed at 0 with "On the house" under it. */
  comp?: boolean;
}

/** Text printed under an on-the-house line. */
export const COMP_LABEL = 'On the house';

export interface ReceiptTaxLine {
  /** Total GST rate (e.g. 5 → CGST 2.5% + SGST 2.5%, or IGST 5%). */
  rate: number;
  taxable: number;
  cgst: number;
  sgst: number;
  /** Inter-state supply: IGST instead of CGST + SGST. */
  igst?: number;
}

export interface ReceiptData {
  business: ReceiptBusiness;
  /** Invoice no, or order code when offline. */
  billNo: string;
  /** Barcode value. */
  code: string;
  tokenNo?: number | null;
  /** ISO timestamp. */
  createdAt: string;
  orderType: string;
  channel?: string | null;
  tableLabel?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  cashier?: string | null;
  items: ReceiptItem[];
  subtotal: number;
  /** Total discount, including the offer's share. */
  discount: number;
  /** Offer applied to the bill; its discount is part of `discount`. */
  offer?: { name: string; discount: number } | null;
  /** Document title: Bill of Supply (no GST charged) or Tax Invoice. Unset = decide from the GSTIN. */
  billType?: 'tax_invoice' | 'bill_of_supply';
  taxBreakup: ReceiptTaxLine[];
  taxTotal: number;
  roundOff: number;
  total: number;
  pricesIncludeTax: boolean;
  payments: { method: string; amount: number }[];
  change?: number;
  loyaltyEarned?: number;
  isDuplicate?: boolean;
  offline?: boolean;
}

export interface KotData {
  kotNo: number | string;
  orderType: string;
  tableLabel?: string | null;
  /** Which bill on a shared table ("Bill 2", "Rahul"). */
  billLabel?: string | null;
  tokenNo?: number | null;
  channel?: string | null;
  brand?: string | null;
  createdAt: string;
  items: { name: string; variant?: string | null; quantity: number; notes?: string | null }[];
  notes?: string | null;
}

/** 58mm → 32 chars/line, 80mm → 48 chars/line (Font A). */
export type PaperWidth = 58 | 80;

export interface EscPosReceiptOptions {
  /** Print the bill barcode (GS k CODE128). Default true. */
  barcode?: boolean;
  /** Print the UPI QR (GS ( k) when business.upiId is set. Default true. Disable for printers without QR support. */
  qr?: boolean;
  /** QR module size in dots. Default 5 (58mm) / 6 (80mm). */
  qrSize?: number;
  /** Kick the cash drawer after printing. Default false. */
  openDrawer?: boolean;
  /** Send the cut command at the end. Default true. */
  cut?: boolean;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

export const charsPerLine = (width: PaperWidth): number => (width === 58 ? 32 : 48);
const dotsPerLine = (width: PaperWidth): number => (width === 58 ? 384 : 576);

const num = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) ? n : 0);

/** 1234567.5 → "12,34,567.50" (Indian digit grouping). */
export function formatMoney(value: number, grouping = true): string {
  const n = num(value);
  const neg = n < 0 && Math.abs(n) >= 0.005;
  const fixed = Math.abs(n).toFixed(2);
  const [int, dec] = fixed.split('.') as [string, string];
  let grouped = int;
  if (grouping && int.length > 3) {
    const last3 = int.slice(-3);
    const rest = int.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
    grouped = `${rest},${last3}`;
  }
  return `${neg ? '-' : ''}${grouped}.${dec}`;
}

/** 2 → "2", 1.5 → "1.5", 0.125 → "0.125". */
export function formatQty(q: number): string {
  const n = num(q);
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

const formatRate = (r: number) => formatQty(Math.round(num(r) * 100) / 100);

/** "TAX INVOICE" / "BILL OF SUPPLY" (older callers without a bill type: tax invoice only with a GSTIN). */
export function receiptTitle(data: Pick<ReceiptData, 'billType' | 'business'>): string {
  if (data.billType === 'bill_of_supply') return 'BILL OF SUPPLY';
  if (data.billType === 'tax_invoice') return 'TAX INVOICE';
  return data.business.gstin ? 'TAX INVOICE' : 'BILL';
}

/** Discount rows: the offer by name, then any other discount (manual / points). */
export function discountRows(data: Pick<ReceiptData, 'discount' | 'offer'>): { label: string; amount: number }[] {
  const total = num(data.discount);
  const offer = data.offer && num(data.offer.discount) > 0 ? Math.min(num(data.offer.discount), total) : 0;
  const rows: { label: string; amount: number }[] = [];
  if (offer > 0) rows.push({ label: `Offer: ${data.offer!.name}`, amount: offer });
  const rest = Math.round((total - offer) * 100) / 100;
  if (rest >= 0.005) rows.push({ label: offer > 0 ? 'Other discount' : 'Discount', amount: rest });
  return rows;
}

/** GST rows per rate: IGST for inter-state lines, else CGST + SGST at half the rate each. */
export function taxRows(breakup: ReceiptTaxLine[]): { label: string; amount: number }[] {
  const rows: { label: string; amount: number }[] = [];
  for (const t of breakup) {
    if (num(t.igst) !== 0) {
      rows.push({ label: `IGST @${formatRate(num(t.rate))}%`, amount: num(t.igst) });
      continue;
    }
    const half = formatRate(num(t.rate) / 2);
    if (num(t.cgst) !== 0) rows.push({ label: `CGST @${half}%`, amount: num(t.cgst) });
    if (num(t.sgst) !== 0) rows.push({ label: `SGST @${half}%`, amount: num(t.sgst) });
  }
  return rows;
}

/** ISO → "23/10/2026 14:05" in device local time. */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** "dine_in" → "Dine In". */
export function humanize(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Word-wraps to `width` columns, hard-splitting words longer than a line. Always returns ≥1 line. */
export function wrapText(text: string, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      let w = word;
      while (w.length > width) {
        if (line) {
          out.push(line);
          line = '';
        }
        out.push(w.slice(0, width));
        w = w.slice(width);
      }
      if (!w) continue;
      if (!line) line = w;
      else if (line.length + 1 + w.length <= width) line += ' ' + w;
      else {
        out.push(line);
        line = w;
      }
    }
    out.push(line);
  }
  // Drop empty lines produced by trailing newlines, but keep at least one line.
  const trimmed = out.filter((l, i) => l !== '' || i === 0);
  return trimmed.length ? trimmed : [''];
}

/** Left + right text on one line of exactly `width` chars; wraps the left part if needed. */
export function twoCol(left: string, right: string, width: number): string[] {
  if (left.length + 1 + right.length <= width) {
    return [left + ' '.repeat(width - left.length - right.length) + right];
  }
  if (left.length <= width) {
    // Keep the left text intact (e.g. a bill number) and put the right part on its own line.
    return [left, ...wrapText(right, width).map((l) => l.padStart(width))];
  }
  const leftWidth = width - right.length - 1;
  if (leftWidth >= 8) {
    const lines = wrapText(left, leftWidth);
    const last = lines.pop()!;
    return [...lines, last + ' '.repeat(width - last.length - right.length) + right];
  }
  return [...wrapText(left, width), ...wrapText(right, width).map((l) => l.padStart(width))];
}

export function buildUpiUrl(upiId: string, payeeName: string, amount: number, note?: string): string {
  const enc = (s: string) => encodeURIComponent(s).replace(/%40/g, '@');
  let url = `upi://pay?pa=${enc(upiId.trim())}&pn=${enc(payeeName.trim())}&am=${num(amount).toFixed(2)}&cu=INR`;
  if (note) url += `&tn=${enc(note)}`;
  return url;
}

// ---------------------------------------------------------------------------
// Intermediate document model (ASCII layout shared by ESC/POS and text output)
// ---------------------------------------------------------------------------

type Block =
  | { kind: 'text'; text: string; align?: Align; bold?: boolean; size?: 'normal' | 'tall' | 'big' }
  | { kind: 'rule'; char: string }
  | { kind: 'barcode'; value: string }
  | { kind: 'qr'; value: string }
  | { kind: 'feed'; lines: number }
  | { kind: 'cut' };

type TextOpts = { align?: Align; bold?: boolean; size?: 'normal' | 'tall' | 'big' };

class Doc {
  blocks: Block[] = [];
  constructor(readonly W: number) {}

  /** Adds (already-ASCII) text, wrapping to the line width for its size. */
  text(text: string, opts: TextOpts = {}): this {
    const max = opts.size === 'big' ? Math.floor(this.W / 2) : this.W;
    for (const line of wrapText(text, max)) this.blocks.push({ kind: 'text', text: line, ...opts });
    return this;
  }
  lines(lines: string[], opts: TextOpts = {}): this {
    for (const l of lines) this.blocks.push({ kind: 'text', text: l, ...opts });
    return this;
  }
  pair(left: string, right: string, opts: TextOpts = {}): this {
    return this.lines(twoCol(left, right, this.W), opts);
  }
  rule(char = '-'): this {
    this.blocks.push({ kind: 'rule', char });
    return this;
  }
  push(b: Block): this {
    this.blocks.push(b);
    return this;
  }
}

interface Columns {
  name: number;
  qty: number;
  rate: number;
  amount: number;
}
const columnsFor = (W: number): Columns =>
  W <= 32 ? { name: 12, qty: 4, rate: 7, amount: 9 } : { name: 24, qty: 6, rate: 9, amount: 9 };

function itemRows(item: ReceiptItem, W: number): string[] {
  const c = columnsFor(W);
  const name = toAscii(item.name) + (item.variant ? ` (${toAscii(item.variant)})` : '');
  const qty = formatQty(item.quantity);
  const rate = item.free || item.comp ? '-' : formatMoney(item.unitPrice, false);
  const amt = item.free ? 'FREE' : item.comp ? formatMoney(0, false) : formatMoney(item.lineTotal, false);
  const note = item.comp ? [`  (${COMP_LABEL})`] : [];
  const fits = qty.length < c.qty && rate.length < c.rate && amt.length < c.amount;
  if (fits) {
    const nameLines = wrapText(name || '-', c.name);
    const first = nameLines[0]!.padEnd(c.name) + qty.padStart(c.qty) + rate.padStart(c.rate) + amt.padStart(c.amount);
    return [first, ...nameLines.slice(1), ...note];
  }
  // Numbers too wide for the columns: name on its own line(s), then "qty x rate ... amount".
  return [...wrapText(name || '-', W), ...twoCol(`  ${qty} x ${rate}`, amt, W), ...note];
}

function receiptDoc(data: ReceiptData, width: PaperWidth): { doc: Doc; upiUrl: string | null } {
  const W = charsPerLine(width);
  const doc = new Doc(W);
  const b = data.business;
  const cur = toAscii(b.currencySymbol || '');

  doc.text(toAscii(b.name) || 'Receipt', { align: 'center', bold: true, size: 'tall' });
  if (b.address) doc.text(toAscii(b.address), { align: 'center' });
  if (b.phone) doc.text(`Ph: ${toAscii(b.phone)}`, { align: 'center' });
  if (b.gstin) doc.text(`GSTIN: ${toAscii(b.gstin)}`, { align: 'center' });
  if (b.fssai) doc.text(`FSSAI: ${toAscii(b.fssai)}`, { align: 'center' });
  doc.rule('=');
  doc.text(receiptTitle(data), { align: 'center', bold: true });
  if (data.isDuplicate) doc.text('*** DUPLICATE ***', { align: 'center', bold: true });
  if (data.offline) doc.text('(Offline bill - pending sync)', { align: 'center' });
  doc.rule();

  doc.pair(`Bill: ${toAscii(data.billNo)}`, formatDateTime(data.createdAt));
  if (data.tokenNo != null) doc.text(`TOKEN ${data.tokenNo}`, { align: 'center', bold: true, size: 'big' });
  const type = `Type: ${toAscii(humanize(data.orderType))}`;
  if (data.tableLabel) doc.pair(type, `Table: ${toAscii(data.tableLabel)}`);
  else doc.text(type);
  if (data.channel) doc.text(`Channel: ${toAscii(humanize(data.channel))}`);
  if (data.customerName) doc.text(`Customer: ${toAscii(data.customerName)}`);
  if (data.customerPhone) doc.text(`Mobile: ${toAscii(data.customerPhone)}`);
  if (data.cashier) doc.text(`Cashier: ${toAscii(data.cashier)}`);
  doc.rule();

  const c = columnsFor(W);
  doc.lines([
    'Item'.padEnd(c.name) + 'Qty'.padStart(c.qty) + 'Rate'.padStart(c.rate) + 'Amount'.padStart(c.amount),
  ], { bold: true });
  doc.rule();
  if (data.items.length === 0) doc.text('(no items)', { align: 'center' });
  for (const item of data.items) doc.lines(itemRows(item, W));
  doc.rule();

  const totalQty = data.items.reduce((s, i) => s + num(i.quantity), 0);
  doc.pair(`Items: ${data.items.length}`, `Qty: ${formatQty(totalQty)}`);
  doc.pair('Subtotal', formatMoney(data.subtotal));
  for (const d of discountRows(data)) doc.pair(toAscii(d.label), `-${formatMoney(d.amount)}`);
  for (const t of taxRows(data.taxBreakup)) doc.pair(t.label, formatMoney(t.amount));
  if (data.taxBreakup.length === 0 && num(data.taxTotal) !== 0) doc.pair('GST', formatMoney(data.taxTotal));
  if (num(data.taxTotal) !== 0 && data.pricesIncludeTax) doc.text('(Prices inclusive of GST)', { align: 'right' });
  if (Math.abs(num(data.roundOff)) >= 0.005) {
    doc.pair('Round Off', `${data.roundOff > 0 ? '+' : ''}${formatMoney(data.roundOff)}`);
  }
  doc.rule('=');
  doc.pair('TOTAL', `${cur}${formatMoney(data.total)}`, { bold: true, size: 'tall' });
  doc.rule('=');

  if (data.payments.length === 0) doc.pair('Payment', 'DUE');
  for (const p of data.payments) doc.pair(`Paid (${toAscii(humanize(p.method)).toUpperCase()})`, formatMoney(p.amount));
  if (num(data.change) > 0) doc.pair('Change', formatMoney(num(data.change)));
  if (num(data.loyaltyEarned) > 0) doc.text(`Loyalty points earned: ${formatQty(num(data.loyaltyEarned))}`);

  if (data.code && isCode128Encodable(data.code)) {
    doc.push({ kind: 'feed', lines: 1 });
    doc.push({ kind: 'barcode', value: data.code });
  }

  let upiUrl: string | null = null;
  if (b.upiId) {
    upiUrl = buildUpiUrl(b.upiId, b.name, data.total, `Bill ${data.billNo}`);
    doc.text('Scan & pay via UPI', { align: 'center', bold: true });
    doc.push({ kind: 'qr', value: upiUrl });
    doc.text(`UPI: ${toAscii(b.upiId)}`, { align: 'center' });
  }

  if (b.footer) doc.text(toAscii(b.footer), { align: 'center' });
  doc.text('Thank you! Visit again.', { align: 'center' });
  return { doc, upiUrl };
}

function kotDoc(data: KotData, width: PaperWidth): Doc {
  const W = charsPerLine(width);
  const doc = new Doc(W);
  doc.text(`KOT #${toAscii(String(data.kotNo))}`, { align: 'center', bold: true, size: 'big' });
  if (data.brand) doc.text(toAscii(data.brand), { align: 'center', bold: true });
  const where = [humanize(data.orderType), data.tableLabel ? `Table ${data.tableLabel}` : ''].filter(Boolean).join(' - ');
  doc.text(toAscii(where).toUpperCase(), { align: 'center', bold: true, size: 'tall' });
  if (data.billLabel) doc.text(`BILL: ${toAscii(data.billLabel)}`, { align: 'center', bold: true });
  if (data.tokenNo != null) doc.text(`TOKEN ${data.tokenNo}`, { align: 'center', bold: true, size: 'big' });
  if (data.channel) doc.text(`Channel: ${toAscii(humanize(data.channel))}`, { align: 'center' });
  doc.text(formatDateTime(data.createdAt), { align: 'center' });
  doc.rule();
  doc.pair('Item', 'Qty', { bold: true });
  doc.rule();
  if (data.items.length === 0) doc.text('(no items)', { align: 'center' });
  for (const it of data.items) {
    const qty = formatQty(it.quantity);
    doc.lines(twoCol(toAscii(it.name) || '-', qty, W), { bold: true, size: 'tall' });
    if (it.variant) doc.text(`  - ${toAscii(it.variant)}`);
    if (it.notes) doc.text(`  >> ${toAscii(it.notes)}`, { bold: true });
  }
  doc.rule();
  const totalQty = data.items.reduce((s, i) => s + num(i.quantity), 0);
  doc.pair(`Items: ${data.items.length}`, `Qty: ${formatQty(totalQty)}`);
  if (data.notes) doc.text(`NOTE: ${toAscii(data.notes)}`, { bold: true });
  return doc;
}

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

function renderText(doc: Doc): string {
  const W = doc.W;
  const out: string[] = [];
  for (const b of doc.blocks) {
    switch (b.kind) {
      case 'text': {
        const t = b.text.slice(0, W);
        if (b.align === 'center') out.push(' '.repeat(Math.floor((W - t.length) / 2)) + t);
        else if (b.align === 'right') out.push(t.padStart(W));
        else out.push(t);
        break;
      }
      case 'rule':
        out.push(b.char.repeat(W));
        break;
      case 'barcode': {
        const t = `||| ${b.value} |||`.slice(0, W);
        out.push(' '.repeat(Math.floor((W - t.length) / 2)) + t);
        break;
      }
      case 'qr': {
        const t = '[ UPI QR ]';
        out.push(' '.repeat(Math.floor((W - t.length) / 2)) + t);
        break;
      }
      case 'feed':
        for (let i = 0; i < b.lines; i++) out.push('');
        break;
      case 'cut':
        break;
    }
  }
  return out.join('\n');
}

function renderEscPos(doc: Doc, width: PaperWidth, opts: EscPosReceiptOptions & { qrSize?: number }): Uint8Array {
  const p = new EscPos().init().codePage(0);
  for (const b of doc.blocks) {
    switch (b.kind) {
      case 'text': {
        const align = b.align ?? 'left';
        if (align !== 'left') p.align(align);
        if (b.bold) p.bold(true);
        if (b.size === 'big') p.size(2, 2);
        else if (b.size === 'tall') p.size(1, 2);
        p.line(b.text);
        if (b.size && b.size !== 'normal') p.size(1, 1);
        if (b.bold) p.bold(false);
        if (align !== 'left') p.align('left');
        break;
      }
      case 'rule':
        p.rule(doc.W, b.char);
        break;
      case 'barcode': {
        if (opts.barcode === false) break;
        const modules = encodeCode128(b.value).totalModules + 20;
        const mw = Math.max(1, Math.min(3, Math.floor(dotsPerLine(width) / modules)));
        p.align('center').barcode128(b.value, { height: 60, moduleWidth: mw, hri: 'below' }).newline().align('left');
        break;
      }
      case 'qr':
        if (opts.qr === false) break;
        p.align('center').qr(b.value, { size: opts.qrSize ?? (width === 58 ? 5 : 6), ecc: 'M' }).newline().align('left');
        break;
      case 'feed':
        p.feed(b.lines);
        break;
      case 'cut':
        p.cut();
        break;
    }
  }
  p.feed(3);
  if (opts.cut !== false) p.cut();
  if (opts.openDrawer) p.drawerKick(0);
  return p.build();
}

export function buildReceiptText(data: ReceiptData, width: PaperWidth): string {
  return renderText(receiptDoc(data, width).doc);
}

export function buildReceiptEscPos(data: ReceiptData, width: PaperWidth, opts: EscPosReceiptOptions = {}): Uint8Array {
  return renderEscPos(receiptDoc(data, width).doc, width, opts);
}

export function buildKotText(data: KotData, width: PaperWidth): string {
  return renderText(kotDoc(data, width));
}

export function buildKotEscPos(data: KotData, width: PaperWidth, opts: Pick<EscPosReceiptOptions, 'cut'> = {}): Uint8Array {
  return renderEscPos(kotDoc(data, width), width, { cut: opts.cut, barcode: false, qr: false });
}

// ---------------------------------------------------------------------------
// HTML (unicode kept; for system print dialog / AirPrint / USB OS printers)
// ---------------------------------------------------------------------------

export function escapeHtml(s: string | number | null | undefined): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function htmlShell(title: string, width: PaperWidth, heightMm: number, body: string): string {
  const inner = width === 58 ? 48 : 72;
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
@page { size: ${width}mm ${Math.ceil(heightMm)}mm; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; color: #000; }
body { width: ${width}mm; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.r { width: ${inner}mm; margin: 0 auto; padding: 2mm 0 4mm; font: ${width === 58 ? 11 : 12}px/1.35 "Courier New", Courier, monospace; }
.c { text-align: center; } .rt { text-align: right; } .b { font-weight: 700; }
.lg { font-size: 1.35em; } .xl { font-size: 1.8em; }
.hr { border-top: 1px dashed #000; margin: 1.5mm 0; } .hr2 { border-top: 2px solid #000; margin: 1.5mm 0; }
table { width: 100%; border-collapse: collapse; } td, th { padding: 0.3mm 0; vertical-align: top; }
th { text-align: left; font-weight: 700; } .n { text-align: right; white-space: nowrap; padding-left: 1.5mm; }
.name { word-break: break-word; } .sub { font-size: 0.9em; padding-left: 2mm; }
.code { text-align: center; margin-top: 2mm; } .code svg { max-width: 100%; height: auto; }
.row { display: flex; justify-content: space-between; gap: 2mm; } .row > span:last-child { white-space: nowrap; text-align: right; }
@media screen { body { margin: 8px auto; box-shadow: 0 0 4px rgba(0,0,0,.3); } }
</style></head>
<body><div class="r">
${body}
</div></body></html>`;
}

const row = (left: string, right: string, cls = '') =>
  `<div class="row${cls ? ' ' + cls : ''}"><span>${left}</span><span>${right}</span></div>`;

export function buildReceiptHtml(data: ReceiptData, width: PaperWidth): string {
  const b = data.business;
  const cur = escapeHtml(b.currencySymbol || '');
  const h: string[] = [];
  let lines = 0; // rough line count for @page height estimation
  const add = (s: string, n = 1) => {
    h.push(s);
    lines += n;
  };
  const charsName = width === 58 ? 14 : 26;

  add(`<div class="c b lg">${escapeHtml(b.name || 'Receipt')}</div>`, 2);
  if (b.address) add(`<div class="c">${escapeHtml(b.address)}</div>`, Math.ceil(b.address.length / (width === 58 ? 30 : 46)));
  if (b.phone) add(`<div class="c">Ph: ${escapeHtml(b.phone)}</div>`);
  if (b.gstin) add(`<div class="c">GSTIN: ${escapeHtml(b.gstin)}</div>`);
  if (b.fssai) add(`<div class="c">FSSAI: ${escapeHtml(b.fssai)}</div>`);
  add('<div class="hr2"></div>');
  add(`<div class="c b">${receiptTitle(data)}</div>`);
  if (data.isDuplicate) add('<div class="c b">*** DUPLICATE ***</div>');
  if (data.offline) add('<div class="c">(Offline bill &ndash; pending sync)</div>');
  add('<div class="hr"></div>');
  add(row(`Bill: ${escapeHtml(data.billNo)}`, escapeHtml(formatDateTime(data.createdAt))));
  if (data.tokenNo != null) add(`<div class="c b xl">TOKEN ${escapeHtml(data.tokenNo)}</div>`, 2);
  add(row(`Type: ${escapeHtml(humanize(data.orderType))}`, data.tableLabel ? `Table: ${escapeHtml(data.tableLabel)}` : ''));
  if (data.channel) add(`<div>Channel: ${escapeHtml(humanize(data.channel))}</div>`);
  if (data.customerName) add(`<div>Customer: ${escapeHtml(data.customerName)}</div>`);
  if (data.customerPhone) add(`<div>Mobile: ${escapeHtml(data.customerPhone)}</div>`);
  if (data.cashier) add(`<div>Cashier: ${escapeHtml(data.cashier)}</div>`);
  add('<div class="hr"></div>');

  const rows = data.items.map((it) => {
    const name = escapeHtml(it.name) + (it.variant ? ` <span class="sub">(${escapeHtml(it.variant)})</span>` : '')
      + (it.comp ? `<div class="sub">${COMP_LABEL}</div>` : '');
    lines += Math.max(1, Math.ceil((it.name.length + (it.variant?.length ?? 0)) / charsName)) + (it.comp ? 1 : 0);
    const rate = it.free || it.comp ? '-' : escapeHtml(formatMoney(it.unitPrice, false));
    const amount = it.free ? 'FREE' : escapeHtml(formatMoney(it.comp ? 0 : it.lineTotal, false));
    return `<tr><td class="name">${name}</td><td class="n">${escapeHtml(formatQty(it.quantity))}</td><td class="n">${rate}</td><td class="n">${amount}</td></tr>`;
  });
  add(
    `<table><thead><tr><th>Item</th><th class="n">Qty</th><th class="n">Rate</th><th class="n">Amount</th></tr></thead><tbody>${
      rows.join('') || '<tr><td colspan="4" class="c">(no items)</td></tr>'
    }</tbody></table>`,
    2,
  );
  add('<div class="hr"></div>');
  const totalQty = data.items.reduce((s, i) => s + num(i.quantity), 0);
  add(row(`Items: ${data.items.length}`, `Qty: ${escapeHtml(formatQty(totalQty))}`));
  add(row('Subtotal', formatMoney(data.subtotal)));
  for (const d of discountRows(data)) add(row(escapeHtml(d.label), `-${formatMoney(d.amount)}`));
  for (const t of taxRows(data.taxBreakup)) add(row(escapeHtml(t.label), formatMoney(t.amount)));
  if (data.taxBreakup.length === 0 && num(data.taxTotal) !== 0) add(row('GST', formatMoney(data.taxTotal)));
  if (num(data.taxTotal) !== 0 && data.pricesIncludeTax) add('<div class="rt">(Prices inclusive of GST)</div>');
  if (Math.abs(num(data.roundOff)) >= 0.005) add(row('Round Off', `${data.roundOff > 0 ? '+' : ''}${formatMoney(data.roundOff)}`));
  add('<div class="hr2"></div>');
  add(row('TOTAL', `${cur}${formatMoney(data.total)}`, 'b lg'), 2);
  add('<div class="hr2"></div>');
  if (data.payments.length === 0) add(row('Payment', 'DUE'));
  for (const p of data.payments) add(row(`Paid (${escapeHtml(humanize(p.method).toUpperCase())})`, formatMoney(p.amount)));
  if (num(data.change) > 0) add(row('Change', formatMoney(num(data.change))));
  if (num(data.loyaltyEarned) > 0) add(`<div>Loyalty points earned: ${escapeHtml(formatQty(num(data.loyaltyEarned)))}</div>`);

  let extraMm = 0;
  if (data.code && isCode128Encodable(data.code)) {
    add(`<div class="code">${barcodeSvg(data.code, { format: 'code128', height: 40, moduleWidth: 1, showText: true, fontSize: 10 })}</div>`, 0);
    extraMm += 18;
  }
  if (b.upiId) {
    const url = buildUpiUrl(b.upiId, b.name, data.total, `Bill ${data.billNo}`);
    const qrPx = width === 58 ? 130 : 160;
    add(`<div class="code"><div class="b">Scan &amp; pay via UPI</div>${qrSvg(url, qrPx, { margin: 2 })}<div>UPI: ${escapeHtml(b.upiId)}</div></div>`, 2);
    extraMm += qrPx * 0.2646 + 4;
  }
  if (b.footer) add(`<div class="c" style="margin-top:2mm">${escapeHtml(b.footer)}</div>`, Math.ceil(b.footer.length / 30) + 1);
  add('<div class="c">Thank you! Visit again.</div>');

  const lineMm = (width === 58 ? 11 : 12) * 1.35 * 0.2646;
  const heightMm = lines * lineMm + extraMm + 16;
  return htmlShell(`Bill ${data.billNo}`, width, heightMm, h.join('\n'));
}

export function buildKotHtml(data: KotData, width: PaperWidth): string {
  const h: string[] = [];
  let lines = 0;
  const add = (s: string, n = 1) => {
    h.push(s);
    lines += n;
  };
  add(`<div class="c b xl">KOT #${escapeHtml(String(data.kotNo))}</div>`, 2);
  if (data.brand) add(`<div class="c b">${escapeHtml(data.brand)}</div>`);
  const where = [humanize(data.orderType), data.tableLabel ? `Table ${data.tableLabel}` : ''].filter(Boolean).join(' - ');
  add(`<div class="c b lg">${escapeHtml(where.toUpperCase())}</div>`, 2);
  if (data.billLabel) add(`<div class="c b">BILL: ${escapeHtml(data.billLabel)}</div>`);
  if (data.tokenNo != null) add(`<div class="c b xl">TOKEN ${escapeHtml(data.tokenNo)}</div>`, 2);
  if (data.channel) add(`<div class="c">Channel: ${escapeHtml(humanize(data.channel))}</div>`);
  add(`<div class="c">${escapeHtml(formatDateTime(data.createdAt))}</div>`);
  add('<div class="hr"></div>');
  const rows = data.items.map((it) => {
    lines += 2 + (it.variant ? 1 : 0) + (it.notes ? 1 : 0);
    return `<tr><td class="name b lg">${escapeHtml(it.name)}${it.variant ? `<div class="sub">- ${escapeHtml(it.variant)}</div>` : ''}${
      it.notes ? `<div class="sub b">&gt;&gt; ${escapeHtml(it.notes)}</div>` : ''
    }</td><td class="n b lg">${escapeHtml(formatQty(it.quantity))}</td></tr>`;
  });
  add(
    `<table><thead><tr><th>Item</th><th class="n">Qty</th></tr></thead><tbody>${
      rows.join('') || '<tr><td colspan="2" class="c">(no items)</td></tr>'
    }</tbody></table>`,
    1,
  );
  add('<div class="hr"></div>');
  const totalQty = data.items.reduce((s, i) => s + num(i.quantity), 0);
  add(row(`Items: ${data.items.length}`, `Qty: ${escapeHtml(formatQty(totalQty))}`));
  if (data.notes) add(`<div class="b">NOTE: ${escapeHtml(data.notes)}</div>`, 2);
  const lineMm = (width === 58 ? 11 : 12) * 1.35 * 0.2646;
  return htmlShell(`KOT ${data.kotNo}`, width, lines * lineMm + 16, h.join('\n'));
}
