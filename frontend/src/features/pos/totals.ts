/**
 * Pricing and payload helpers for the POS. Prices are previewed locally (same maths as the server via
 * lib/billing previewTotals) but the server always re-prices from its own catalog.
 */
import type { BusinessSettings, ChannelCode, Order, OrderItem, PaymentInput, Product, SalesChannel, TaxSnapshot } from '@/api/types';
import type { BillCreateInput } from '@/api/floor';
import { availableOn, isFreeItem, markupPrice, isVoidItem, previewTotals, spreadOfferDiscount, taxRateFor, unitPriceFor, type PricePreview } from '@/lib/billing';
import { CHANNEL_LABEL, round2, shortCode } from '@/lib/format';
import { ApiError } from '@/api/client';
import type { CartLine, Draft } from './cart';

export const AGGREGATORS: ChannelCode[] = ['SWIGGY', 'ZOMATO', 'ONDC', 'MAGICPIN', 'OTHER'];
export const POS_CHANNELS: ChannelCode[] = ['POS', ...AGGREGATORS];
export const isAggregator = (c: ChannelCode) => AGGREGATORS.includes(c);

export const PHONE_RE = /^\+?[0-9 ]{6,16}$/;

/**
 * Why a new bill that the server didn't take should be kept on this device (outbox, same idempotent id), or null to show the error.
 * offline = no connection; lapsed = 402, the subscription ended at that moment (the app shows the renewal screen,
 * the outbox is kept while locked and syncs after renewal). Nothing the cashier rang up is lost either way.
 */
export function saveOnDevice(e: unknown): 'offline' | 'lapsed' | null {
  if (!(e instanceof ApiError)) return null;
  if (e.network) return 'offline';
  if (e.status === 402) return 'lapsed';
  return null;
}

export interface PricedLine {
  line: CartLine;
  product: Product | null;
  unitPrice: number;
  taxRate: number;
  total: number;
  /** Switched off on the bill's sales channel (e.g. not on the Zomato menu). */
  unavailable: boolean;
}

export interface PricedDraft {
  lines: PricedLine[];
  /** Items already on a running bill, including cancelled ones (shown struck through, never charged). */
  existing: OrderItem[];
  preview: PricePreview;
  /** Items in the cart (new + already-sent), counted by quantity. */
  itemCount: number;
  newCount: number;
  redeemValue: number;
  paid: number;
  due: number;
  /** Lines whose product is no longer on the menu (or not on this channel's menu) — must be removed before billing. */
  missing: CartLine[];
  /** Pre-tax discount of the offer in the preview (0 = none). */
  offerDiscount: number;
  /** The non-offer discount (manual + points) in the preview. */
  manualDiscount: number;
}

/** The offer to preview: its pre-tax discount and which products it covers. */
export interface PreviewOffer {
  discount: number;
  covers: (productId: string) => boolean;
}

export function channelAdjust(channels: SalesChannel[], code: ChannelCode): number {
  return channels.find((c) => c.code === code)?.price_adjust_pct ?? 0;
}

export function priceDraft(draft: Draft, productsById: Map<string, Product>, settings: BusinessSettings | null, adjustPct: number,
  opts: { tax?: TaxSnapshot | null; offer?: PreviewOffer | null } = {}): PricedDraft {
  const missing: CartLine[] = [];
  const lines: PricedLine[] = draft.lines.map((line) => {
    const product = productsById.get(line.productId) ?? null;
    const unavailable = !!product && product.is_active && !availableOn(product, draft.channel);
    if (!product || !product.is_active || unavailable) missing.push(line);
    // Per-item channel price (Swiggy / Zomato menu) when set, else the channel's % mark-up — as the server prices it
    const unitPrice = product ? unitPriceFor(product, line.variantId, adjustPct, draft.channel) : markupPrice(line.price, adjustPct);
    const taxRate = product ? taxRateFor(product, settings, opts.tax)
      : opts.tax && opts.tax.registration !== 'regular' ? 0 : line.taxRate ?? settings?.default_tax_rate ?? 0;
    return { line, product, unitPrice, taxRate, total: round2(unitPrice * line.quantity), unavailable };
  });
  const existing = draft.resume?.items ?? [];
  // Cancelled lines are never charged; free items added by an offer cost nothing and are left out of the offer maths, as on the server
  const charged = existing.filter((i) => !isVoidItem(i));
  const rows = [
    ...charged.filter((i) => !isFreeItem(i)).map((i) => ({ unitPrice: i.unit_price, quantity: i.quantity, taxRate: i.tax_rate, productId: i.product_id })),
    ...lines.map((l) => ({ unitPrice: l.unitPrice, quantity: l.line.quantity, taxRate: l.taxRate, productId: l.line.productId })),
  ];

  // Offer first (targeted line discounts), then the bill discount on what is left:
  // server: discount = offer + min(rest, round(rest * pct) + flat + points value)
  const offer = opts.offer && opts.offer.discount > 0 ? opts.offer : null;
  const lineDiscounts = offer ? spreadOfferDiscount(rows, settings, offer.discount, (i) => offer.covers(rows[i]!.productId)) : null;
  const base = previewTotals(rows, settings, null, lineDiscounts);
  const rest = Math.max(0, round2(base.subtotal - base.offerDiscount));
  const redeemValue = round2((draft.redeemPoints || 0) * (settings?.loyalty_point_value ?? 0));
  let flat = redeemValue;
  if (draft.discount && draft.discount.value > 0) {
    flat += draft.discount.type === 'percent' ? round2((rest * Math.min(draft.discount.value, 100)) / 100) : round2(draft.discount.value);
  } else if (draft.resume && !redeemValue) {
    // a running order keeps its own (non-offer) discount until changed at payment
    flat = Math.max(0, round2(draft.resume.discount_amount - (draft.resume.offer_discount ?? 0)));
  }
  const preview = flat > 0 ? previewTotals(rows, settings, { type: 'flat', value: round2(flat) }, lineDiscounts) : base;
  const paid = draft.resume?.paid_amount ?? 0;
  const newCount = lines.reduce((s, l) => s + l.line.quantity, 0);
  return {
    lines, existing, preview, redeemValue, missing, paid, newCount,
    offerDiscount: preview.offerDiscount, manualDiscount: Math.max(0, round2(preview.discount - preview.offerDiscount)),
    itemCount: newCount + charged.reduce((s, i) => s + i.quantity, 0),
    due: Math.max(0, round2(preview.total - paid)),
  };
}

/** What still blocks this bill from being sent (null = ok). */
export function validateDraft(draft: Draft, priced: PricedDraft, opts: { requireLines: boolean }): string | null {
  if (opts.requireLines && priced.lines.length === 0) return draft.resume ? 'Add new items first' : 'Add items to the bill first';
  if (priced.missing.length) {
    const line = priced.lines.find((l) => l.line.id === priced.missing[0].id);
    return line?.unavailable
      ? `${line.line.name} isn't on the ${CHANNEL_LABEL[draft.channel] ?? draft.channel} menu. Remove it to continue.`
      : `${priced.missing[0].name} is no longer on the menu. Remove it to continue.`;
  }
  if (!draft.resume) {
    if (draft.orderType === 'DINE_IN' && !draft.tableId) return 'Pick a table for this dine-in order';
    if (draft.orderType === 'DELIVERY' && !isAggregator(draft.channel)) {
      if (!draft.customer?.name || !draft.customer.phone) return 'Add the customer name and phone for delivery';
      if (!draft.deliveryAddress.trim()) return 'Add the delivery address';
    }
  }
  if (draft.customer?.phone && !PHONE_RE.test(draft.customer.phone)) return 'Customer phone number looks wrong';
  return null;
}

/**
 * `offerId`: the offer shown in the preview (sent by id so the server bills exactly what the cashier saw).
 * Auto offers are never added behind the cashier's back (auto_offers: false) — the preview already
 * includes the best one — and bills saved offline carry no offer at all.
 */
export function buildCreatePayload(draft: Draft, opts: { id: string; createdAt: string; payments?: PaymentInput[]; sendToKitchen: boolean; offline?: boolean; offerId?: string | null }): BillCreateInput {
  const orderType = draft.orderType ?? 'TAKEAWAY';
  const customer = draft.customer;
  const tableNote = opts.offline && orderType === 'DINE_IN' && draft.tableLabel ? `Table ${draft.tableLabel}` : '';
  const notes = [tableNote, draft.notes.trim()].filter(Boolean).join(' · ');
  return {
    id: opts.id,
    // Only bills saved offline carry the device time; online bills use the server clock
    created_at: opts.offline ? opts.createdAt : undefined,
    order_type: orderType,
    channel: draft.channel,
    // Offline bills don't claim tables (occupancy lives on the server); the table goes on the bill note instead
    table_id: orderType === 'DINE_IN' && !opts.offline ? draft.tableId : null,
    customer_id: customer?.id ?? null,
    customer_name: customer?.name?.trim() || null,
    customer_phone: customer?.phone?.replace(/\s/g, '') || null,
    delivery_address: orderType === 'DELIVERY' ? draft.deliveryAddress.trim() || null : null,
    external_order_id: isAggregator(draft.channel) ? draft.externalOrderId.trim() || null : null,
    notes: notes || null,
    items: draft.lines.map((l) => ({ product_id: l.productId, variant_id: l.variantId, quantity: l.quantity, notes: l.notes })),
    discount: draft.discount && draft.discount.value > 0 ? draft.discount : null,
    redeem_points: draft.redeemPoints || 0,
    payments: opts.payments ?? [],
    send_to_kitchen: opts.sendToKitchen,
    offer_id: !opts.offline && opts.offerId ? opts.offerId : null,
    auto_offers: false,
    // A separate bill on a table that already has one; name and guests tell the bills apart
    ...(orderType === 'DINE_IN' && !opts.offline && draft.tableId ? {
      new_bill: draft.newBill || undefined,
      bill_label: draft.billLabel.trim() || null,
      guests: draft.guests || null,
    } : {}),
  };
}

/** Order-shaped object built on the device for bills saved offline, so the receipt can be shown and printed. */
export function buildLocalOrder(payload: BillCreateInput, priced: PricedDraft, draft: Draft, change: number): Order {
  const id = payload.id!;
  const p = priced.preview;
  const payments = (payload.payments ?? []).map((pay, i) => ({ id: `${id}-p${i}`, method: pay.method, amount: pay.amount, reference: pay.reference ?? null }));
  const paidRaw = payments.reduce((s, x) => s + x.amount, 0);
  const paid = round2(paidRaw - change);
  return {
    id, code: shortCode(id), invoice_no: null, token_no: null, type: payload.order_type, channel: payload.channel ?? 'POS',
    external_order_id: payload.external_order_id ?? null, status: paid >= p.total ? 'completed' : 'open',
    payment_status: paid >= p.total ? 'paid' : paid > 0 ? 'partial' : 'unpaid',
    table_id: null, table_label: payload.order_type === 'DINE_IN' ? draft.tableLabel : null,
    customer_id: payload.customer_id ?? null, brand_id: null, customer_name: payload.customer_name ?? null, customer_phone: payload.customer_phone ?? null,
    delivery_address: payload.delivery_address ?? null, notes: payload.notes ?? null,
    subtotal: p.subtotal, discount_amount: p.discount, tax_amount: p.tax, round_off: p.roundOff, total_amount: p.total,
    paid_amount: paid, balance_due: Math.max(0, round2(p.total - paid)), commission_amount: 0,
    loyalty_points_earned: 0, loyalty_points_redeemed: payload.redeem_points ?? 0, cancel_reason: null,
    created_at: payload.created_at ?? new Date().toISOString(), completed_at: null,
    items: priced.lines.map((l, i) => ({
      id: `${id}-i${i}`, product_id: l.line.productId, variant_id: l.line.variantId, name: l.line.name, variant_name: l.line.variantName,
      quantity: l.line.quantity, unit_price: l.unitPrice, tax_rate: l.taxRate, tax_amount: 0, line_total: l.total, notes: l.line.notes,
      sent_to_kitchen: !!payload.send_to_kitchen,
    })),
    payments: payments.map((x) => (x.method === 'CASH' && change ? { ...x, amount: round2(Math.max(0, x.amount - change)) } : x)),
    tax_breakup: p.taxBreakup,
    change,
    bill_type: p.tax > 0 ? 'tax_invoice' : 'bill_of_supply',
    offer_id: null, offer_name: null, offer_discount: 0,
  };
}

/** Quick cash amounts: exact, then the next round ₹50 / ₹100 / ₹500 / ₹2000 above the amount due. */
export function quickCash(due: number): number[] {
  const out = [due];
  for (const step of [50, 100, 500, 2000]) {
    const v = Math.ceil(due / step) * step;
    if (v > due && !out.includes(v)) out.push(v);
  }
  return out.slice(0, 5);
}

export function matchesQuery(p: Product, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return p.name.toLowerCase().includes(needle)
    || (!!p.sku && p.sku.toLowerCase().includes(needle))
    || (!!p.barcode && p.barcode.toLowerCase().includes(needle));
}

/** Exact barcode / SKU hit (keyboard-wedge scanners and camera scans). */
export function findByCode(products: Product[], code: string): Product | null {
  const c = code.trim().toLowerCase();
  if (!c) return null;
  return products.find((p) => p.is_active && ((p.barcode && p.barcode.toLowerCase() === c) || (p.sku && p.sku.toLowerCase() === c))) ?? null;
}
