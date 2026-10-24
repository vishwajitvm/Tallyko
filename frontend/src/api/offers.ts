// Offers & loyalty rewards (backend/app/api/offers.py, backend/app/api/orders.py offer routes).
import { api } from './client';
import type { ChannelCode, Order, OrderItemInput, OrderType, PaymentInput, DiscountInput } from './types';

export type OfferKind = 'bill' | 'items' | 'loyalty';
export type OfferBenefit = 'percent' | 'flat' | 'free_item';
export type OfferState = 'live' | 'scheduled' | 'expired' | 'off' | 'used_up';

/** An offer as the server returns it. Times are "HH:MM" in the shop's timezone; dates are UTC ISO strings. */
export interface Offer {
  id: string;
  name: string;
  description: string | null;
  code: string | null;
  kind: OfferKind;
  benefit_type: OfferBenefit;
  benefit_value: number;
  max_discount: number | null;
  free_product_id: string | null;
  free_quantity: number;
  min_order_amount: number;
  product_ids: string[];
  category_ids: string[];
  min_visits: number | null;
  visits_window_days: number | null;
  channels: string[] | null;
  order_types: OrderType[] | null;
  /** 0 = Monday … 6 = Sunday */
  days_of_week: number[] | null;
  start_time: string | null;
  end_time: string | null;
  starts_at: string | null;
  ends_at: string | null;
  auto_apply: boolean;
  is_active: boolean;
  priority: number;
  max_uses_total: number | null;
  max_uses_per_customer: number | null;
  uses_count: number;
  notify_email: boolean;
  /** Plain-language summary written by the server, e.g. "20% off (max ₹150) on bills above ₹500 · Fri, Sat". */
  summary: string;
  state: OfferState;
  redemptions: number;
}

/** Body for create / update (POST /offers, PUT /offers/{id}). */
export interface OfferInput {
  name: string;
  description?: string | null;
  code?: string | null;
  kind: OfferKind;
  benefit_type: OfferBenefit;
  benefit_value: number;
  max_discount?: number | null;
  free_product_id?: string | null;
  free_quantity?: number;
  min_order_amount?: number;
  product_ids?: string[];
  category_ids?: string[];
  min_visits?: number | null;
  visits_window_days?: number | null;
  channels?: string[] | null;
  order_types?: OrderType[] | null;
  days_of_week?: number[] | null;
  start_time?: string | null;
  end_time?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  auto_apply?: boolean;
  is_active?: boolean;
  priority?: number;
  max_uses_total?: number | null;
  max_uses_per_customer?: number | null;
  notify_email?: boolean;
}

/** One offer checked against a cart or order. `discount` is the pre-tax amount off. */
export interface OfferEvaluation {
  offer_id: string;
  name: string;
  description: string;
  eligible: boolean;
  /** Why it doesn't apply (shown to staff), null when eligible. */
  reason: string | null;
  discount: number;
  free_product_id: string | null;
  auto_apply: boolean;
  /** Only on GET /orders/{id}/offers */
  applied?: boolean;
}

export interface CartEvaluation {
  best_auto_offer_id: string | null;
  offers: OfferEvaluation[];
}

export interface CartEvaluateInput {
  items: OrderItemInput[];
  channel?: ChannelCode | string;
  order_type?: OrderType;
  customer_id?: string | null;
  customer_phone?: string | null;
  code?: string | null;
}

export const offersApi = {
  /** Managers get every offer; staff with only `offers.apply` get the active ones. */
  list: (includeInactive = true) => api.get<Offer[]>('/offers', { query: { include_inactive: includeInactive } }),
  create: (body: OfferInput) => api.post<Offer>('/offers', body),
  update: (id: string, body: OfferInput) => api.put<Offer>(`/offers/${id}`, body),
  setActive: (id: string, is_active: boolean) => api.put<Offer>(`/offers/${id}/active`, { is_active }),
  /** Which offers apply to a cart that isn't an order yet. Short timeout: billing never waits on this. */
  evaluate: (body: CartEvaluateInput) => api.post<CartEvaluation>('/offers/evaluate', body, { timeoutMs: 8000 }),
  /** Email the offer to customers who opted in to offers (needs `email.manage`). */
  announce: (id: string) => api.post<{ queued: number; opted_in_customers: number }>(`/offers/${id}/announce`),

  // Offers on an existing order
  forOrder: (orderId: string) => api.get<OfferEvaluation[]>(`/orders/${orderId}/offers`),
  setOnOrder: (orderId: string, body: { offer_id?: string | null; offer_code?: string | null; remove?: boolean }) =>
    api.post<Order & { warning?: string | null }>(`/orders/${orderId}/offer`, body),
  /** Pay an order, optionally applying (offer_id) or removing (remove_offer) an offer first. */
  payWithOffer: (orderId: string, body: {
    payments: PaymentInput[]; discount?: DiscountInput | null; redeem_points?: number | null; offer_id?: string | null; remove_offer?: boolean;
  }) => api.post<Order>(`/orders/${orderId}/pay`, body),
};
