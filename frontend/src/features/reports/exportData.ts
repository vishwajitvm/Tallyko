/** CSV + printable HTML builders for reports (pure functions, no platform APIs). */
import type { SalesSummary } from '@/api/types';
import { CHANNEL_LABEL, ORDER_TYPE_LABEL, PAYMENT_LABEL, money } from '@/lib/format';
import { hourLabel } from './range';
import type { ItemRow, StaffRow, WastageRow } from './useReports';

type Cell = string | number | null | undefined;

function csvCell(v: Cell): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'number' ? String(Math.round(v * 100) / 100) : v;
  // Quote when needed; neutralise spreadsheet formula injection from item names
  const safe = /^[=+\-@\t\r]/.test(s) && typeof v === 'string' ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(rows: Cell[][]): string {
  // BOM so Excel opens UTF-8 (₹, Hindi item names) correctly
  return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function itemsCsv(items: ItemRow[], periodLabel: string): string {
  const rows: Cell[][] = [[`Item-wise sales — ${periodLabel}`], [], ['Item', 'Variant', 'Quantity', 'Revenue (excl. tax)', 'Tax']];
  for (const i of items) rows.push([i.name, i.variant ?? '', i.quantity, i.revenue, i.tax]);
  rows.push(['Total', '', items.reduce((n, i) => n + i.quantity, 0), items.reduce((n, i) => n + i.revenue, 0), items.reduce((n, i) => n + i.tax, 0)]);
  return toCsv(rows);
}

export function summaryCsv(s: SalesSummary, periodLabel: string, extra: { staff?: StaffRow[] | null; wastage?: WastageRow[] | null }): string {
  const rows: Cell[][] = [
    [`Sales summary — ${periodLabel}`], [],
    ['Metric', 'Value'],
    ['Orders', s.orders],
    ['Gross sales', s.gross_sales],
    ['Net sales (excl. tax, after discounts)', s.net_sales],
    ['GST collected', s.tax],
    ['Discounts', s.discounts],
    ['Aggregator commission', s.commission],
    ['Net payout after commission', s.gross_sales - s.commission],
    ['Round off', s.round_off],
    ['Average order value', s.average_order_value],
    ['Cancelled orders', s.cancelled_orders],
    ['Cancelled value', s.cancelled_value],
    ['Open orders (now)', s.open_orders],
    ['Open value (now)', s.open_value],
    [],
    ['Payment method', 'Amount', 'Payments'],
    ...[...s.by_payment].sort((a, b) => b.amount - a.amount).map((p) => [PAYMENT_LABEL[p.method] ?? p.method, p.amount, p.count]),
    [],
    ['Channel', 'Orders', 'Gross', 'Commission', 'Net'],
    ...s.by_channel.map((c) => [CHANNEL_LABEL[c.channel] ?? c.channel, c.orders, c.amount, c.commission, c.net]),
    [],
    ['Order type', 'Orders', 'Amount'],
    ...s.by_type.map((t) => [ORDER_TYPE_LABEL[t.type] ?? t.type, t.orders, t.amount]),
    [],
    ['Category', 'Quantity', 'Revenue (excl. tax)'],
    ...s.by_category.map((c) => [c.category, c.quantity, c.revenue]),
    [],
    ['Top item', 'Quantity', 'Revenue (excl. tax)'],
    ...s.top_items.map((t) => [t.name, t.quantity, t.revenue]),
    [],
    ['Hour', 'Sales'],
    ...s.hourly.map((v, h) => [`${hourLabel(h)} – ${hourLabel((h + 1) % 24)}`, v]),
  ];
  if (extra.staff?.length) {
    rows.push([], ['Staff', 'Orders', 'Sales']);
    for (const r of extra.staff) rows.push([r.name, r.orders, r.amount]);
  }
  if (extra.wastage?.length) {
    rows.push([], ['Wastage item', 'Quantity', 'Cost']);
    for (const r of extra.wastage) rows.push([r.product, r.quantity, r.cost]);
  }
  return toCsv(rows);
}

function esc(s: string | number | null | undefined): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

/** Day-end (Z-report style) summary, laid out for a receipt printer or A4. */
export function dayEndHtml(s: SalesSummary, opts: { businessName: string; periodLabel: string; singleDay: boolean; symbol?: string; printedBy?: string | null }): string {
  const sym = opts.symbol ?? '₹';
  const m = (v: number) => esc(money(v, sym));
  const cash = s.by_payment.filter((p) => p.method === 'CASH').reduce((n, p) => n + p.amount, 0);
  const row = (label: string, value: string, strong = false) =>
    `<tr${strong ? ' class="strong"' : ''}><td>${esc(label)}</td><td class="r">${value}</td></tr>`;
  const section = (title: string, body: string) => `<h2>${esc(title)}</h2><table>${body}</table>`;
  const printedAt = new Date().toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });

  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(opts.singleDay ? 'Day-end summary' : 'Sales summary')} — ${esc(opts.periodLabel)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, 'Segoe UI', Roboto, Arial, sans-serif; color: #111; margin: 0; padding: 16px; }
  .wrap { max-width: 380px; margin: 0 auto; }
  h1 { font-size: 18px; margin: 0; text-align: center; }
  .sub { text-align: center; font-size: 12px; color: #444; margin: 2px 0; }
  h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; margin: 16px 0 4px; padding-bottom: 4px; border-bottom: 1px dashed #999; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  td { padding: 3px 0; vertical-align: top; }
  td.r { text-align: right; white-space: nowrap; padding-left: 12px; font-variant-numeric: tabular-nums; }
  tr.strong td { font-weight: 700; }
  .drawer { margin-top: 14px; border: 2px solid #111; padding: 10px; display: flex; justify-content: space-between; font-size: 16px; font-weight: 700; }
  .foot { margin-top: 18px; text-align: center; font-size: 11px; color: #555; }
  .sign { margin-top: 28px; display: flex; justify-content: space-between; font-size: 11px; color: #555; }
  .sign span { border-top: 1px solid #999; padding-top: 4px; width: 45%; text-align: center; }
  @media print { body { padding: 0; } }
</style></head><body><div class="wrap">
<h1>${esc(opts.businessName)}</h1>
<p class="sub"><strong>${opts.singleDay ? 'Day-end summary' : 'Sales summary'}</strong></p>
<p class="sub">${esc(opts.periodLabel)}</p>
${section('Sales', [
    row('Orders', String(s.orders)),
    row('Gross sales', m(s.gross_sales), true),
    row('Discounts', m(s.discounts)),
    row('GST collected', m(s.tax)),
    row('Net sales (excl. GST)', m(s.net_sales)),
    row('Round off', m(s.round_off)),
    s.commission ? row('Aggregator commission', m(s.commission)) : '',
    s.commission ? row('Net payout after commission', m(s.gross_sales - s.commission), true) : '',
    row('Average order value', m(s.average_order_value)),
  ].join(''))}
${section('Payments received', [...s.by_payment].sort((a, b) => b.amount - a.amount).map((p) =>
    row(`${PAYMENT_LABEL[p.method] ?? p.method} (${p.count})`, m(p.amount))).join('') + row('Total', m(s.by_payment.reduce((n, p) => n + p.amount, 0)), true))}
<div class="drawer"><span>Cash in drawer</span><span>${m(cash)}</span></div>
${s.by_channel.length ? section('Channels', [...s.by_channel].sort((a, b) => b.amount - a.amount).map((c) => row(`${CHANNEL_LABEL[c.channel] ?? c.channel} (${c.orders})`, m(c.amount))).join('')) : ''}
${s.by_type.length ? section('Order types', s.by_type.map((t) => row(`${ORDER_TYPE_LABEL[t.type] ?? t.type} (${t.orders})`, m(t.amount))).join('')) : ''}
${section('Exceptions', row(`Cancelled orders (${s.cancelled_orders})`, m(s.cancelled_value)) + row(`Open orders now (${s.open_orders})`, m(s.open_value)))}
${s.top_items.length ? section('Top items', s.top_items.slice(0, 5).map((t) => row(`${t.name} × ${t.quantity}`, m(t.revenue))).join('')) : ''}
<div class="sign"><span>Cashier</span><span>Manager</span></div>
<p class="foot">Printed ${esc(printedAt)}${opts.printedBy ? ` by ${esc(opts.printedBy)}` : ''} · Tallyko</p>
</div></body></html>`;
}
