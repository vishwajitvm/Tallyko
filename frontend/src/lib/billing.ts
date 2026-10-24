/**
 * Shared billing helpers: local price preview (mirrors backend/app/services/pricing.py),
 * order -> receipt/KOT mapping, and one-call printing that respects the user's printer prefs.
 */
import type { BusinessSettings, ChannelCode, Order, OrderItem, Product, KitchenTicket, TaxLine, TaxSnapshot } from '@/api/types';
import type { KotData, ReceiptData } from '@/lib/print/receipt';
import { printKot, printReceipt, PrinterError } from '@/lib/print/printers';
import { usePrefs } from '@/store/prefs';
import { useAuth } from '@/store/auth';
import { useData } from '@/store/data';
import { resolveTaxRate } from '@/lib/tax';
import { ORDER_TYPE_LABEL, CHANNEL_LABEL, round2 } from './format';

export interface CartLine {
  key: string; // product + variant + notes
  product: Product;
  variantId: string | null;
  variantName: string | null;
  unitPrice: number;
  quantity: number;
  notes: string | null;
}

export function lineKey(productId: string, variantId: string | null, notes: string | null = null) {
  return `${productId}:${variantId ?? ''}:${notes ?? ''}`;
}

/** The product's own entry for a sales channel ({price?, available?}), if any. */
function channelEntry(product: Pick<Product, 'channel_prices'>, channel: ChannelCode | null | undefined): { price?: number | null; available?: boolean } | null {
  if (!channel) return null;
  return product.channel_prices?.[channel.toUpperCase() as ChannelCode] ?? null;
}

/** False when the item is switched off for this channel's menu (backend/app/services/channel_menu.py available_on). */
export function availableOn(product: Pick<Product, 'is_active' | 'channel_prices'>, channel: ChannelCode | null | undefined): boolean {
  return !!product.is_active && channelEntry(product, channel)?.available !== false;
}

/**
 * Price of one unit (with the option) on a channel, before tax and offers — mirrors channel_menu.unit_price:
 * the item's own channel price when set (an option keeps its extra cost on top), else the channel's % mark-up
 * on (base + option), rounded to the rupee.
 */
export function unitPriceFor(product: Product, variantId: string | null, channelAdjustPct = 0, channel: ChannelCode | null = null): number {
  const variant = variantId ? product.variants.find((v) => v.id === variantId) : null;
  const modifier = variant ? round2(variant.price - product.base_price) : 0;
  const own = channelEntry(product, channel)?.price;
  if (own !== undefined && own !== null && Number.isFinite(Number(own))) return round2(Number(own) + modifier);
  return markupPrice(variant ? variant.price : product.base_price, channelAdjustPct);
}

/** A channel's % mark-up on a counter price: apps list whole rupees, so it rounds half-up to the rupee (₹249 + 8% → ₹269). */
export function markupPrice(price: number, adjustPct: number): number {
  if (!adjustPct) return round2(price);
  return Math.round(round2(price * (1 + adjustPct / 100)) + 1e-9);
}

/** A cancelled line: kept on the bill for the record and the kitchen, never charged or printed. */
export function isVoidItem(item: Pick<OrderItem, 'is_void' | 'kitchen_status'>): boolean {
  return !!item.is_void || item.kitchen_status === 'void';
}

/** On the house: free on this bill, with the reason and its normal value kept for reports. */
export function isCompItem(item: Pick<OrderItem, 'comp_reason'>): boolean {
  return !!item.comp_reason;
}

export interface PricePreview {
  subtotal: number;
  /** Every discount: offer + manual + points (what the server stores as discount_amount). */
  discount: number;
  /** Part of `discount` that came from the offer (targeted line discounts). */
  offerDiscount: number;
  tax: number;
  roundOff: number;
  total: number;
  taxBreakup: { rate: number; taxable: number; cgst: number; sgst: number }[];
}

/**
 * Same maths as the server (GST per line, inclusive/exclusive, proportional discount, round to rupee),
 * so the cashier sees the right total instantly — and offline bills match what the server later records.
 *
 * `lineDiscounts` (row index -> pre-tax amount) are offer discounts aimed at specific lines; the bill
 * `discount` is then spread over what is left of every line (backend/app/services/pricing.py price_order).
 */
export function previewTotals(lines: { unitPrice: number; quantity: number; taxRate: number }[], settings: Pick<BusinessSettings, 'prices_include_tax'> | null,
  discount: { type: 'flat' | 'percent'; value: number } | null = null, lineDiscounts: (number | undefined)[] | null = null): PricePreview {
  const inclusive = !!settings?.prices_include_tax;
  const rows = lines.map((l, i) => {
    const gross = round2(l.unitPrice * l.quantity);
    const taxable = inclusive ? round2(gross / (1 + l.taxRate / 100)) : gross;
    const targeted = Math.min(taxable, round2(Math.max(0, lineDiscounts?.[i] ?? 0)));
    return { gross, taxable, rate: l.taxRate, discount: targeted, tax: 0 };
  });
  const subtotal = round2(rows.reduce((s, r) => s + r.taxable, 0));
  const targeted = round2(rows.reduce((s, r) => s + r.discount, 0));
  const remainingValue = round2(subtotal - targeted);
  let disc = 0;
  if (discount && discount.value > 0) disc = discount.type === 'percent' ? round2((remainingValue * Math.min(discount.value, 100)) / 100) : round2(discount.value);
  disc = Math.max(0, Math.min(disc, remainingValue));
  let remaining = disc;
  rows.forEach((r, i) => {
    const lineValue = round2(r.taxable - r.discount);
    const share = remainingValue <= 0 ? 0 : i === rows.length - 1 ? Math.min(remaining, lineValue) : Math.min(remaining, round2((disc * lineValue) / remainingValue));
    r.discount = round2(r.discount + share);
    remaining = round2(remaining - share);
    r.tax = round2(((r.taxable - r.discount) * r.rate) / 100);
  });
  const totalDiscount = round2(targeted + disc);
  let tax = round2(rows.reduce((s, r) => s + r.tax, 0));
  let raw = round2(subtotal - totalDiscount + tax);
  if (inclusive && totalDiscount === 0) {
    raw = round2(rows.reduce((s, r) => s + r.gross, 0));
    tax = round2(raw - subtotal);
  }
  const total = Math.round(raw + 1e-9);
  const byRate = new Map<number, { taxable: number; tax: number }>();
  rows.forEach((r) => {
    const b = byRate.get(r.rate) ?? { taxable: 0, tax: 0 };
    b.taxable += r.taxable - r.discount;
    b.tax += r.tax;
    byRate.set(r.rate, b);
  });
  const taxBreakup = Array.from(byRate.entries()).sort(([a], [b]) => a - b).map(([rate, b]) => {
    const cgst = round2(b.tax / 2);
    return { rate, taxable: round2(b.taxable), cgst, sgst: round2(b.tax - cgst) };
  });
  return { subtotal, discount: totalDiscount, offerDiscount: targeted, tax, roundOff: round2(total - raw), total, taxBreakup };
}

/**
 * Spread an offer's pre-tax discount over the lines it covers, in proportion to their pre-tax value
 * (backend/app/services/offers.py evaluate). Returns one entry per row (0 for lines the offer skips).
 */
export function spreadOfferDiscount(rows: { unitPrice: number; quantity: number; taxRate: number }[], settings: Pick<BusinessSettings, 'prices_include_tax'> | null,
  discount: number, eligible: (index: number) => boolean = () => true): number[] {
  const inclusive = !!settings?.prices_include_tax;
  const taxable = rows.map((l) => {
    const gross = round2(l.unitPrice * l.quantity);
    return inclusive ? round2(gross / (1 + l.taxRate / 100)) : gross;
  });
  const idx = rows.map((_, i) => i).filter((i) => eligible(i));
  const out = rows.map(() => 0);
  const base = round2(idx.reduce((s, i) => s + taxable[i]!, 0));
  if (!(discount > 0) || base <= 0) return out;
  const total = Math.min(round2(discount), base);
  let remaining = total;
  idx.forEach((i, n) => {
    const share = n === idx.length - 1 ? remaining : Math.min(remaining, round2((total * taxable[i]!) / base));
    out[i] = share;
    remaining = round2(remaining - share);
  });
  return out;
}

/** Prefix the server puts on the note of a line added by a free-item offer ("Free — Weekend combo"). */
export const FREE_ITEM_NOTE = 'Free — ';

export function isFreeItem(item: Pick<OrderItem, 'unit_price' | 'notes'> & { is_free?: boolean }): boolean {
  if (typeof item.is_free === 'boolean') return item.is_free;
  return !item.unit_price && !!item.notes && item.notes.startsWith(FREE_ITEM_NOTE);
}

/**
 * GST rate the server will charge for this product now: its tax class, else the legacy per-product rate,
 * else the business default (0 for composition / unregistered businesses). Pass `tax` from `useData` in
 * React code so previews re-render when the tax snapshot changes; it defaults to the cached snapshot.
 */
export function taxRateFor(product: Product, settings: BusinessSettings | null, tax: TaxSnapshot | null | undefined = useData.getState().tax): number {
  return resolveTaxRate(product, tax, settings);
}

export function receiptFromOrder(order: Order, settings: BusinessSettings | null, opts: { duplicate?: boolean; offline?: boolean; change?: number } = {}): ReceiptData {
  const session = useAuth.getState().session;
  return {
    business: {
      name: settings?.business_name ?? session?.businessName ?? 'Tallyko',
      address: settings?.address, phone: settings?.phone, gstin: settings?.gstin, fssai: settings?.fssai,
      footer: settings?.receipt_footer, currencySymbol: settings?.currency_symbol ?? '₹', upiId: settings?.upi_id,
    },
    billNo: order.invoice_no ?? order.code,
    code: order.code,
    tokenNo: order.token_no,
    createdAt: order.created_at,
    orderType: ORDER_TYPE_LABEL[order.type] ?? order.type,
    channel: order.channel !== 'POS' ? CHANNEL_LABEL[order.channel] ?? order.channel : null,
    // Separate bills on one table: "7 (Rahul)" so each party gets the right one
    tableLabel: order.table_label ? (order.bill_label ? `${order.table_label} (${order.bill_label})` : order.table_label) : null,
    customerName: order.customer_name,
    customerPhone: order.customer_phone,
    cashier: session?.fullName ?? null,
    // Cancelled lines never reach the customer's bill; on-the-house lines print at 0 with the reason
    items: order.items.filter((i) => !isVoidItem(i)).map((i) => {
      const comp = isCompItem(i);
      return {
        name: i.name, variant: i.variant_name, quantity: i.quantity, unitPrice: comp ? 0 : i.unit_price, lineTotal: comp ? 0 : i.line_total,
        taxRate: i.tax_rate, free: (!comp && isFreeItem(i)) || undefined, comp: comp || undefined,
      };
    }),
    subtotal: order.subtotal,
    discount: order.discount_amount,
    offer: order.offer_name ? { name: order.offer_name, discount: order.offer_discount ?? 0 } : null,
    billType: order.bill_type ?? (order.tax_amount > 0 ? 'tax_invoice' : 'bill_of_supply'),
    taxBreakup: order.tax_breakup.map((t: TaxLine & { igst?: number }) => ({ rate: t.rate, taxable: t.taxable, cgst: t.cgst, sgst: t.sgst, igst: t.igst ?? 0 })),
    taxTotal: order.tax_amount,
    roundOff: order.round_off,
    total: order.total_amount,
    pricesIncludeTax: !!settings?.prices_include_tax,
    payments: order.payments.map((p) => ({ method: p.method, amount: p.amount })),
    change: opts.change ?? order.change,
    loyaltyEarned: order.loyalty_points_earned || undefined,
    isDuplicate: opts.duplicate,
    offline: opts.offline,
  };
}

export function kotFromOrder(order: Order, onlyNew = false): KotData {
  const items = order.items.filter((i) => (!onlyNew || i.sent_to_kitchen) && !isVoidItem(i));
  return {
    kotNo: order.token_no ?? order.code,
    orderType: ORDER_TYPE_LABEL[order.type] ?? order.type,
    tableLabel: order.table_label ?? null,
    billLabel: order.bill_label ?? null,
    tokenNo: order.token_no,
    channel: order.channel !== 'POS' ? CHANNEL_LABEL[order.channel] ?? order.channel : null,
    createdAt: order.created_at,
    items: items.map((i) => ({ name: i.name, variant: i.variant_name, quantity: i.quantity, notes: i.notes })),
    notes: order.notes,
  };
}

type TicketLike = Omit<KitchenTicket, 'items'> & { bill_label?: string | null; items: (KitchenTicket['items'][number] & { is_void?: boolean })[] };

export function kotFromTicket(t: TicketLike): KotData {
  return {
    kotNo: t.kot_no ?? t.order_code, orderType: ORDER_TYPE_LABEL[t.type] ?? t.type, tableLabel: t.table_label, tokenNo: t.token_no,
    channel: t.channel !== 'POS' ? CHANNEL_LABEL[t.channel] ?? t.channel : null, brand: t.brand, createdAt: t.created_at,
    billLabel: t.bill_label ?? null,
    items: t.items.filter((i) => !i.is_void).map((i) => ({ name: i.name, variant: i.variant_name, quantity: i.quantity, notes: i.notes })), notes: t.notes,
  };
}

/** Print a bill with the saved printer (system dialog if none). Throws PrinterError with a friendly message. */
export async function printBill(order: Order, settings: BusinessSettings | null, opts: { duplicate?: boolean; offline?: boolean; change?: number } = {}) {
  const prefs = usePrefs.getState();
  await printReceipt(prefs.printer, receiptFromOrder(order, settings, opts), prefs.paperWidth, {
    barcode: prefs.printBarcodeOnBill, qr: prefs.printQrOnBill, openDrawer: prefs.openCashDrawer && !opts.duplicate,
  });
}

export async function printKitchenTicket(data: KotData) {
  const prefs = usePrefs.getState();
  await printKot(prefs.kitchenPrinter ?? prefs.printer, data, prefs.paperWidth);
}

export function printErrorMessage(e: unknown): string {
  if (e instanceof PrinterError) return e.message;
  return e instanceof Error ? e.message : 'Could not print. Check the printer and try again.';
}
