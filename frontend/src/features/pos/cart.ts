/**
 * The bill being rung up on the POS. Persisted per business (tenant) so an accidental refresh,
 * app kill or crash never loses a half-entered bill, and one business's cart never shows in another.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { persistStorage } from '@/lib/storage';
import type { ChannelCode, Customer, DiscountInput, Order, OrderType, Product } from '@/api/types';

export interface CartLine {
  /** Local line id (stable while editing notes/qty). */
  id: string;
  productId: string;
  variantId: string | null;
  name: string;
  variantName: string | null;
  /** Snapshot of the catalog price when added (used only if the product disappears from the cache). */
  price: number;
  taxRate: number | null;
  quantity: number;
  notes: string | null;
}

export interface AttachedCustomer {
  /** null = new customer captured offline; the server creates it from name + phone when the bill syncs. */
  id: string | null;
  name: string;
  phone: string;
  points: number;
  tier: Customer['tier'] | null;
}

export interface Draft {
  lines: CartLine[];
  orderType: OrderType | null;
  tableId: string | null;
  tableLabel: string | null;
  channel: ChannelCode;
  externalOrderId: string;
  customer: AttachedCustomer | null;
  deliveryAddress: string;
  notes: string;
  discount: DiscountInput | null;
  redeemPoints: number;
  /** Idempotency key of the bill. Kept between retries of an unchanged cart, reset on any edit. */
  draftId: string | null;
  /** A running (open) order loaded from the server; new lines get added to it. */
  resume: Order | null;
  /**
   * New dine-in bill on a table that already has one (two parties, separate cheques):
   * sent as `new_bill` so the server opens another bill instead of refusing.
   */
  newBill: boolean;
  /** Name of a new bill ("Rahul", "Bill 2"); empty = the server numbers it. */
  billLabel: string;
  guests: number | null;
  /**
   * Offer for this bill. auto = the best auto-apply offer the server suggests for the cart,
   * manual = the offer the cashier picked (or found by coupon code), none = no offer.
   */
  offerMode: OfferMode;
  offerId: string | null;
  /** Name of the manually picked offer, so it can be shown before the next evaluation. */
  offerName: string | null;
  /** Coupon code the customer quoted (shown on the cart; the offer itself is sent by id). */
  offerCode: string | null;
  updatedAt: number;
}

export type OfferMode = 'auto' | 'manual' | 'none';

export const EMPTY_DRAFT: Draft = {
  lines: [], orderType: null, tableId: null, tableLabel: null, channel: 'POS', externalOrderId: '', customer: null,
  deliveryAddress: '', notes: '', discount: null, redeemPoints: 0, draftId: null, resume: null, newBill: false, billLabel: '', guests: null,
  offerMode: 'auto', offerId: null, offerName: null, offerCode: null, updatedAt: 0,
};

let seq = 0;
const lineId = () => `${Date.now().toString(36)}-${(++seq).toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

interface CartState {
  tenantId: string | null;
  drafts: Record<string, Draft>;
  /** Last line touched, so the cart can highlight / scroll to it. Not persisted. */
  lastLineId: string | null;
  setTenant: (tenantId: string | null) => void;
  patch: (patch: Partial<Draft>) => void;
  add: (product: Product, variantId?: string | null, quantity?: number) => void;
  setQty: (id: string, quantity: number) => void;
  bump: (id: string, delta: number) => void;
  setNote: (id: string, notes: string | null) => void;
  remove: (id: string) => void;
  /** Start a fresh bill. Keeps the order type (and optionally the channel) for the next customer. */
  reset: (keep?: { orderType?: OrderType | null; channel?: ChannelCode }) => void;
  /** Open a running bill. `keepLines`: carry the unsent items over (e.g. they belong to the other bill on the table). */
  loadOrder: (order: Order, opts?: { keepLines?: boolean }) => void;
}

/** Edits to items, prices or discount invalidate the previous idempotency key. */
const PRICE_FIELDS: (keyof Draft)[] = ['lines', 'channel', 'discount', 'redeemPoints', 'orderType', 'tableId', 'customer', 'offerMode', 'offerId', 'newBill'];

export const useCart = create<CartState>()(
  persist(
    (set, get) => {
      const update = (fn: (d: Draft) => Partial<Draft>) => {
        const tenantId = get().tenantId;
        if (!tenantId) return;
        set((s) => {
          const current = s.drafts[tenantId] ?? EMPTY_DRAFT;
          const next = fn(current);
          const invalidates = PRICE_FIELDS.some((k) => k in next);
          return {
            drafts: { ...s.drafts, [tenantId]: { ...current, ...next, ...(invalidates && !('draftId' in next) ? { draftId: null } : null), updatedAt: Date.now() } },
          };
        });
      };

      return {
        tenantId: null,
        drafts: {},
        lastLineId: null,
        setTenant: (tenantId) => set({ tenantId }),
        patch: (p) => update(() => p),
        add: (product, variantId = null, quantity = 1) => {
          const variant = variantId ? product.variants.find((v) => v.id === variantId) ?? null : null;
          let touched: string | null = null;
          update((d) => {
            const existing = d.lines.find((l) => l.productId === product.id && l.variantId === (variant?.id ?? null) && !l.notes);
            if (existing) {
              touched = existing.id;
              return { lines: d.lines.map((l) => (l.id === existing.id ? { ...l, quantity: Math.min(9999, l.quantity + quantity) } : l)) };
            }
            const line: CartLine = {
              id: lineId(), productId: product.id, variantId: variant?.id ?? null, name: product.name, variantName: variant?.name ?? null,
              price: variant ? variant.price : product.base_price, taxRate: product.tax_rate, quantity, notes: null,
            };
            touched = line.id;
            return { lines: [...d.lines, line] };
          });
          set({ lastLineId: touched });
        },
        setQty: (id, quantity) => {
          const q = Math.floor(quantity);
          update((d) => ({ lines: q <= 0 ? d.lines.filter((l) => l.id !== id) : d.lines.map((l) => (l.id === id ? { ...l, quantity: Math.min(9999, q) } : l)) }));
          set({ lastLineId: id });
        },
        bump: (id, delta) => {
          const line = (get().drafts[get().tenantId ?? ''] ?? EMPTY_DRAFT).lines.find((l) => l.id === id);
          if (line) get().setQty(id, line.quantity + delta);
        },
        setNote: (id, notes) => update((d) => ({ lines: d.lines.map((l) => (l.id === id ? { ...l, notes: notes?.trim() ? notes.trim().slice(0, 200) : null } : l)) })),
        remove: (id) => update((d) => ({ lines: d.lines.filter((l) => l.id !== id) })),
        reset: (keep) => {
          update(() => ({ ...EMPTY_DRAFT, orderType: keep?.orderType ?? null, channel: keep?.channel ?? 'POS' }));
          set({ lastLineId: null });
        },
        loadOrder: (order, opts) => {
          update((d) => ({
            ...EMPTY_DRAFT,
            lines: opts?.keepLines ? d.lines : [],
            resume: order,
            // A running bill keeps the offer it already has until the cashier changes it
            ...(order.offer_id ? { offerMode: 'manual' as OfferMode, offerId: order.offer_id, offerName: order.offer_name ?? null } : {}),
            orderType: order.type,
            tableId: order.table_id,
            tableLabel: order.table_label ?? null,
            channel: order.channel,
            externalOrderId: order.external_order_id ?? '',
            deliveryAddress: order.delivery_address ?? '',
            customer: order.customer_phone || order.customer_name
              ? { id: order.customer_id, name: order.customer_name ?? 'Guest', phone: order.customer_phone ?? '', points: 0, tier: null }
              : null,
          }));
          set({ lastLineId: null });
        },
      };
    },
    {
      name: 'tallyko.pos.cart',
      storage: persistStorage,
      version: 1,
      partialize: (s) => ({ drafts: s.drafts }),
      // tenantId comes from the signed-in session, never from storage
      // Drafts saved by older versions miss newer fields (offers): fill them from the empty draft
      merge: (persisted, current) => {
        const saved = ((persisted as Partial<CartState>)?.drafts ?? {}) as Record<string, Partial<Draft>>;
        const drafts: Record<string, Draft> = {};
        for (const [k, d] of Object.entries(saved)) drafts[k] = { ...EMPTY_DRAFT, ...d };
        return { ...current, drafts };
      },
    },
  ),
);

/** The current business's draft (stable reference when nothing changed). */
export function useDraft(): Draft {
  return useCart((s) => (s.tenantId ? s.drafts[s.tenantId] ?? EMPTY_DRAFT : EMPTY_DRAFT));
}

export function getDraft(): Draft {
  const s = useCart.getState();
  return s.tenantId ? s.drafts[s.tenantId] ?? EMPTY_DRAFT : EMPTY_DRAFT;
}
