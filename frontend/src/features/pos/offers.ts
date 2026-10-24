/**
 * Offers on the POS: asks the server which offers fit the current cart (debounced, online only),
 * resolves the cashier's choice (best auto offer / a picked offer / none) and spreads the discount over
 * the cart lines for the local price preview. Offers never block billing: offline or on any error the
 * bill simply goes through without one.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import { isOffline } from '@/api/client';
import { offersApi, type CartEvaluation, type Offer, type OfferEvaluation, type OfferKind } from '@/api/offers';
import type { OrderItemInput, Product } from '@/api/types';
import { isFreeItem } from '@/lib/billing';
import type { Draft } from './cart';
import { PHONE_RE } from './totals';

/** The offer the bill preview (and the order sent to the server) uses. `discount` is pre-tax. */
export interface AppliedOffer {
  id: string;
  name: string;
  description: string;
  discount: number;
  freeProductId: string | null;
  freeQuantity: number;
  /** From the offer definition when known: which lines an "items" offer covers. */
  kind: OfferKind | null;
  productIds: string[];
  categoryIds: string[];
  /** True while the shown offer comes from the running bill and hasn't been re-checked yet. */
  fromOrder?: boolean;
}

// ---------------------------------------------------------------------------
// Active offers (for coupon codes and line targeting), kept in memory per login
// ---------------------------------------------------------------------------

interface OfferCatalog {
  offers: Offer[];
  loadedAt: number;
  load: (force?: boolean) => Promise<void>;
  clear: () => void;
}

const CATALOG_TTL = 5 * 60 * 1000;
let catalogLoading: Promise<void> | null = null;

export const useOfferCatalog = create<OfferCatalog>()((set, get) => ({
  offers: [],
  loadedAt: 0,
  load: async (force = false) => {
    if (!force && Date.now() - get().loadedAt < CATALOG_TTL) return;
    if (catalogLoading) return catalogLoading;
    catalogLoading = offersApi.list(false)
      .then((offers) => set({ offers: offers.filter((o) => o.is_active), loadedAt: Date.now() }))
      .catch(() => { /* offline or no access: codes are looked up again next time */ })
      .finally(() => { catalogLoading = null; });
    return catalogLoading;
  },
  clear: () => set({ offers: [], loadedAt: 0 }),
}));

export function findOfferByCode(offers: Offer[], code: string): Offer | null {
  const c = code.trim().toUpperCase();
  if (!c) return null;
  return offers.find((o) => o.code && o.code.toUpperCase() === c) ?? null;
}

// ---------------------------------------------------------------------------
// Cart → evaluation
// ---------------------------------------------------------------------------

/** Paid items of the running bill plus the new lines: what the offer rules look at. */
export function cartItemsForOffers(draft: Draft): OrderItemInput[] {
  const existing = (draft.resume?.items ?? []).filter((i) => !isFreeItem(i))
    .map((i) => ({ product_id: i.product_id, variant_id: i.variant_id, quantity: i.quantity }));
  const fresh = draft.lines.map((l) => ({ product_id: l.productId, variant_id: l.variantId, quantity: l.quantity }));
  return [...existing, ...fresh];
}

function evaluationKey(draft: Draft, items: OrderItemInput[]): string {
  const phone = draft.customer?.phone?.replace(/\s/g, '') ?? '';
  return JSON.stringify({
    i: items.map((x) => [x.product_id, x.variant_id ?? '', x.quantity]),
    c: draft.resume?.channel ?? draft.channel,
    t: draft.resume?.type ?? draft.orderType ?? 'TAKEAWAY',
    u: draft.resume?.customer_id ?? draft.customer?.id ?? '',
    p: PHONE_RE.test(phone) ? phone : '',
  });
}

export interface CartOffers {
  /** Server answer for the cart (null before the first answer, offline, or when offers are off). */
  data: CartEvaluation | null;
  /** The answer is for an older version of the cart, or a request is running. */
  pending: boolean;
  error: string | null;
  /** Offers apply only after the first payment is taken on a running bill. */
  locked: boolean;
  applied: AppliedOffer | null;
  /** Why the offer the cashier picked can't be used right now. */
  problem: string | null;
  eligible: OfferEvaluation[];
  ineligible: OfferEvaluation[];
  bestAuto: OfferEvaluation | null;
  /** Re-ask the server now. */
  refresh: () => void;
  /** Make sure the answer matches the current cart (waits up to `maxMs`, then gives up quietly). */
  flush: (maxMs?: number) => Promise<void>;
}

const DEBOUNCE_MS = 450;

export function useCartOffers({ draft, enabled, online }: { draft: Draft; enabled: boolean; online: boolean }): CartOffers {
  const catalog = useOfferCatalog((s) => s.offers);
  const loadCatalog = useOfferCatalog((s) => s.load);
  const items = useMemo(() => cartItemsForOffers(draft), [draft]);
  const key = useMemo(() => evaluationKey(draft, items), [draft, items]);
  const locked = !!draft.resume && (draft.resume.paid_amount ?? 0) > 0;
  const active = enabled && online && !locked && items.length > 0;

  const [result, setResult] = useState<{ key: string; data: CartEvaluation } | null>(null);
  const [error, setError] = useState<{ key: string; message: string | null } | null>(null);
  const [running, setRunning] = useState(false);
  const seq = useRef(0);
  const inflight = useRef<{ key: string; promise: Promise<void> } | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  useEffect(() => {
    if (enabled && online) void loadCatalog();
  }, [enabled, online, loadCatalog]);

  const run = useCallback((forKey: string): Promise<void> => {
    if (inflight.current?.key === forKey) return inflight.current.promise;
    const id = ++seq.current;
    const d = draftRef.current;
    const phone = d.customer?.phone?.replace(/\s/g, '') ?? '';
    setRunning(true);
    const promise = offersApi.evaluate({
      items: cartItemsForOffers(d),
      channel: d.resume?.channel ?? d.channel,
      order_type: d.resume?.type ?? d.orderType ?? 'TAKEAWAY',
      customer_id: d.resume?.customer_id ?? d.customer?.id ?? null,
      customer_phone: PHONE_RE.test(phone) ? phone : null,
    })
      .then((data) => {
        if (id !== seq.current) return;
        setResult({ key: forKey, data });
        setError(null);
      })
      .catch((e) => {
        if (id !== seq.current) return;
        // Offers are optional: forget suggestions and let the bill go through without one
        setResult(null);
        setError({ key: forKey, message: isOffline(e) ? null : 'Could not check offers' });
      })
      .finally(() => {
        if (id === seq.current) setRunning(false);
        if (inflight.current?.key === forKey) inflight.current = null;
      });
    inflight.current = { key: forKey, promise };
    return promise;
  }, []);

  useEffect(() => {
    if (!active) {
      seq.current++;
      inflight.current = null;
      setRunning(false);
      if (!online || !enabled || items.length === 0) setResult(null);
      return undefined;
    }
    if (result?.key === key || error?.key === key) return undefined;
    const t = setTimeout(() => void run(key), DEBOUNCE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, key, run]);

  const keyRef = useRef(key);
  keyRef.current = key;
  const activeRef = useRef(active);
  activeRef.current = active;
  const settledKeyRef = useRef<string | null>(null);
  settledKeyRef.current = result?.key === key ? key : error?.key === key ? key : null;

  const flush = useCallback(async (maxMs = 4000) => {
    // Nothing to wait for when the answer (or a failure) for this exact cart is already in
    if (!activeRef.current || settledKeyRef.current === keyRef.current) return;
    await Promise.race([run(keyRef.current), new Promise<void>((r) => setTimeout(r, maxMs))]);
  }, [run]);

  const refresh = useCallback(() => {
    if (!activeRef.current) return;
    inflight.current = null;
    void run(keyRef.current);
  }, [run]);

  const data = active ? result?.data ?? null : null;
  const pending = active && (running || (result?.key !== key && error?.key !== key));

  const resolved = useMemo(() => {
    const byId = new Map(catalog.map((o) => [o.id, o]));
    const toApplied = (ev: OfferEvaluation): AppliedOffer => {
      const def = byId.get(ev.offer_id);
      return {
        id: ev.offer_id, name: ev.name, description: ev.description, discount: ev.discount, freeProductId: ev.free_product_id,
        freeQuantity: def?.free_quantity ?? 1, kind: def?.kind ?? null, productIds: def?.product_ids ?? [], categoryIds: def?.category_ids ?? [],
      };
    };
    const eligible = data?.offers.filter((o) => o.eligible) ?? [];
    const ineligible = data?.offers.filter((o) => !o.eligible) ?? [];
    const bestAuto = data?.best_auto_offer_id ? data.offers.find((o) => o.offer_id === data.best_auto_offer_id) ?? null : null;
    const resume = draft.resume;
    // What the running bill already carries (shown until the server re-checks it)
    const fromOrder: AppliedOffer | null = resume?.offer_id ? {
      id: resume.offer_id, name: resume.offer_name ?? 'Offer', description: '', discount: resume.offer_discount ?? 0,
      freeProductId: null, freeQuantity: 0, kind: null, productIds: [], categoryIds: [], fromOrder: true,
    } : null;

    if (!enabled) return { applied: null, problem: null, eligible, ineligible, bestAuto };
    if (locked) return { applied: fromOrder, problem: null, eligible: [], ineligible: [], bestAuto: null };
    if (draft.offerMode === 'none') return { applied: null, problem: null, eligible, ineligible, bestAuto };
    if (draft.offerMode === 'manual' && draft.offerId) {
      const ev = data?.offers.find((o) => o.offer_id === draft.offerId);
      if (ev?.eligible) return { applied: toApplied(ev), problem: null, eligible, ineligible, bestAuto };
      if (!data) {
        // Not checked yet: keep the running bill's own offer in the preview when nothing new was added
        const keep = fromOrder && fromOrder.id === draft.offerId && draft.lines.length === 0 ? fromOrder : null;
        return { applied: keep, problem: null, eligible, ineligible, bestAuto };
      }
      return { applied: null, problem: ev?.reason ?? `${draft.offerName ?? 'This offer'} is no longer active`, eligible, ineligible, bestAuto };
    }
    if (bestAuto?.eligible) return { applied: toApplied(bestAuto), problem: null, eligible, ineligible, bestAuto };
    if (!data && fromOrder && draft.lines.length === 0 && online) return { applied: fromOrder, problem: null, eligible, ineligible, bestAuto };
    return { applied: null, problem: null, eligible, ineligible, bestAuto };
  }, [data, catalog, draft.resume, draft.offerMode, draft.offerId, draft.offerName, draft.lines.length, enabled, locked, online]);

  return { data, pending, error: active && error?.key === key ? error.message : null, locked, ...resolved, refresh, flush };
}

/** Does an offer's discount cover this product? (Bill and loyalty offers cover every line.) */
export function offerCovers(offer: AppliedOffer, productId: string, productsById: Map<string, Product>): boolean {
  if (offer.kind !== 'items') return true;
  if (offer.productIds.includes(productId)) return true;
  const category = productsById.get(productId)?.category_id;
  return !!category && offer.categoryIds.includes(category);
}

/** "₹50 off" / "Free item" for an offer row. */
export function offerValueLabel(ev: Pick<OfferEvaluation, 'discount' | 'free_product_id'>, money: (n: number) => string): string {
  if (ev.free_product_id && !(ev.discount > 0)) return 'Free item';
  return ev.discount > 0 ? `−${money(ev.discount)}` : '';
}
