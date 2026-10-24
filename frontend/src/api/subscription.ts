/**
 * The business's own Tallyko subscription (renewal, plans, offers, "I've paid" claims) and signed-in devices.
 * These endpoints keep working after the subscription ends; everything else answers 402 then.
 */
import { api } from './client';
import type { SubscriptionState } from './types';

export interface PriceOption {
  months: number;
  price: number;
  label: string;
  per_month: number;
  saving: number;
}

export interface SubscriptionPlan {
  key: string;
  name: string;
  description: string | null;
  price_monthly: number;
  features: string[];
  limits: Record<string, number | null>;
  options: PriceOption[];
}

export interface SubscriptionOffer {
  id: string;
  code: string;
  name: string;
  description: string | null;
  discount_type: 'percent' | 'flat' | 'none' | string;
  discount_value: number;
  extra_days: number | null;
  plan_keys: string[] | null;
  min_months: number | null;
  starts_at: string | null;
  ends_at: string | null;
  new_businesses_only: boolean;
  summary: string;
}

export interface PaymentDetails {
  upi_id: string;
  payee_name: string;
  bank_details: string;
  support_phone: string;
  support_email: string;
  instructions: string;
}

export type PaymentMethod = 'upi' | 'bank_transfer' | 'cash' | 'card' | 'cheque' | 'other';

export interface PaymentRequest {
  id: string;
  plan_key: string;
  months: number;
  offer_code: string | null;
  amount: number;
  method: PaymentMethod;
  reference: string;
  note: string | null;
  status: 'pending' | 'approved' | 'rejected';
  review_note: string | null;
  created_at: string;
  reviewed_at: string | null;
}

export interface SubscriptionPeriod {
  id: string;
  start_date: string;
  end_date: string;
  kind: 'trial' | 'paid' | 'complimentary' | 'development' | string;
  plan_name: string | null;
  months: number | null;
  amount_paid: number;
  offer: string | null;
}

export interface SubscriptionInfo extends SubscriptionState {
  plan_key: string;
  plan_name: string;
  grace_days: number;
  /** Only the owner can send an "I've paid" claim */
  can_pay: boolean;
  plans: SubscriptionPlan[];
  offers: SubscriptionOffer[];
  payment: PaymentDetails;
  requests: PaymentRequest[];
  history: SubscriptionPeriod[];
}

export interface Quote {
  plan_key: string;
  plan_name: string;
  months: number;
  list_price: number;
  discount: number;
  extra_days: number;
  amount: number;
  offer: SubscriptionOffer | null;
  offer_error: string | null;
}

export interface PaymentClaimInput {
  plan_key: string;
  months: number;
  offer_code?: string | null;
  amount: number;
  method: PaymentMethod;
  reference: string;
  note?: string | null;
}

export interface DeviceSession {
  id: string;
  device: string;
  ip: string | null;
  created_at: string;
  last_seen_at: string | null;
  current: boolean;
}

export const subscriptionApi = {
  get: () => api.get<SubscriptionInfo>('/subscription'),
  quote: (body: { plan_key: string; months: number; offer_code?: string | null }) => api.post<Quote>('/subscription/quote', body),
  claim: (body: PaymentClaimInput) => api.post<PaymentRequest & { expected_amount: number }>('/subscription/requests', body),
};

export const sessionsApi = {
  list: () => api.get<DeviceSession[]>('/auth/sessions'),
  signOutDevice: (id: string) => api.delete<{ success: boolean }>(`/auth/sessions/${id}`),
  /** Revokes this device on the server. Short timeout: signing out must never hang on a bad connection. */
  logout: () => api.post<{ success: boolean }>('/auth/logout', undefined, { timeoutMs: 6000 }),
};
