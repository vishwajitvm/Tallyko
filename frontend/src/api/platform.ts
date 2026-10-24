/**
 * Tallyko platform (super admin console) API: `/api/v1/platform/*`.
 * Only platform logins can call these; `support` may read, every write needs `super_admin` (403 otherwise).
 * Shapes mirror `backend/app/api/platform.py`.
 */
import { api, headerJson, headerNumber } from './client';
import type { BusinessType, PlatformRole } from './types';

export type BusinessStatus = 'active' | 'suspended' | 'deleted';
export type SubscriptionStatus = 'none' | 'active' | 'expired';
export type LimitKey = 'max_staff' | 'max_products' | 'max_locations';
/** `null` = unlimited */
export type Limits = Partial<Record<LimitKey, number | null>>;
export type PaymentMethod = 'upi' | 'bank_transfer' | 'cash' | 'card' | 'cheque' | 'free' | 'other';

export const LIMIT_KEYS: LimitKey[] = ['max_staff', 'max_products', 'max_locations'];

/** trial = free demo · development = no expiry until switched off · grace = paid period over, not locked yet · lapsed = locked (API answers 402) */
/** Businesses list filter (server-side) */
export type AccessFilter = 'locked' | 'trial' | 'development' | 'active' | 'expiring';

export type AccessState = 'trial' | 'development' | 'active' | 'grace' | 'lapsed';
export type SubscriptionKind = 'trial' | 'paid' | 'complimentary' | 'development';
export type RecordKind = 'paid' | 'complimentary' | 'trial';

export interface AccessInfo {
  state: AccessState;
  kind?: SubscriptionKind | null;
  /** e.g. "Free demo", "Development access" (null for some paid periods) */
  label?: string | null;
  paid_until: string | null;
  lock_at?: string | null;
  /** null for development access (no expiry) */
  days_left: number | null;
  locked: boolean;
}

export interface PlatformMe {
  user_id: string;
  email: string;
  platform_role: PlatformRole;
  can_edit: boolean;
}

export interface PlatformOverview {
  /** Count per status, e.g. { active: 12, suspended: 1, deleted: 2 } (missing keys = 0) */
  businesses: Partial<Record<BusinessStatus, number>>;
  /** Active businesses per plan key */
  by_plan: Record<string, number>;
  by_type: Record<string, number>;
  new_this_month: number;
  revenue_this_month: number;
  renewals_due_7_days: number;
  /** Active businesses whose subscription ended (the owner sees the renewal page) */
  locked: number;
  pending_payment_requests: number;
  last_subscription_check: SubscriptionCheckRun | null;
}

export interface SubscriptionCheckRun {
  last_run_at: string;
  businesses_checked: number;
  locked_now: number;
  renewals_due_soon: number;
  duration_ms: number;
  by: string;
}

export interface FeatureInfo {
  key: string;
  name: string;
}

export interface BusinessSummary {
  id: string;
  name: string;
  business_type: BusinessType;
  status: BusinessStatus;
  status_reason: string | null;
  plan_key: string;
  owner: { name: string | null; email: string | null; phone: string | null };
  staff_count: number;
  created_at: string;
  paid_until: string | null;
  subscription_status: SubscriptionStatus;
  last_activity_at: string | null;
  access: AccessInfo;
  locked: boolean;
  /** When the daily check locked the business */
  lapsed_at: string | null;
}

export interface BusinessList {
  total: number;
  items: BusinessSummary[];
  /** `with_counts=true`: businesses per access state for the same q / status / plan (before the access filter). */
  counts?: Partial<Record<'all' | AccessFilter, number>> | null;
}

export interface SubscriptionRecord {
  id?: string;
  start_date: string;
  end_date: string;
  plan_key: string;
  plan_name: string;
  features: string[];
  limits: Limits;
  price_monthly: number;
  months: number;
  amount_paid: number;
  payment_method: PaymentMethod;
  payment_reference: string | null;
  note: string | null;
  recorded_by: string;
  /** Older payments have no kind: treat as 'paid' */
  kind?: SubscriptionKind;
  list_price?: number;
  discount?: number;
  extra_days?: number;
  amount_due?: number;
  offer?: { id: string; code: string | null; name: string } | null;
  paid_at?: string;
}

export interface BusinessDetail extends BusinessSummary {
  admin_notes: string | null;
  feature_overrides: Record<string, boolean>;
  limit_overrides: Limits;
  /** What the business can use now (plan ± overrides − modules the owner hid) */
  effective_features: string[];
  /** Plan ± overrides, before the owner's hidden modules (not the plan's own list: see `PlanInfo.features`) */
  plan_features: string[];
  hidden_by_owner: string[];
  /** Effective limits (plan limits with overrides applied) */
  limits: Limits;
  products: number;
  settings: { address: string | null; phone: string | null; email: string | null; gstin: string | null; gst_registration: string | null } | null;
  staff: { id: string; name: string | null; email: string; role: string; is_active: boolean }[];
  subscriptions: SubscriptionRecord[];
  features_catalog: FeatureInfo[];
  /** Development access is on (no expiry until switched off) */
  development: boolean;
  /** The plan's own feature list (before this business's overrides) */
  plan_default_features: string[];
}

export interface BusinessCreateBody {
  business_name: string;
  business_type: BusinessType;
  owner_name: string;
  owner_email: string;
  owner_phone: string;
  plan_key: string;
  /** Leave out to have the server generate a temporary password */
  password?: string;
  /** Free demo length: leave out for the platform default, 0 = no demo */
  demo_days?: number | null;
  development?: boolean;
}

export interface BusinessCreated {
  id: string;
  owner_email: string;
  /** null when a password was supplied */
  temporary_password: string | null;
}

export interface BusinessUpdateBody {
  status?: 'active' | 'suspended';
  status_reason?: string | null;
  plan_key?: string;
  feature_overrides?: Record<string, boolean>;
  limit_overrides?: Limits;
  admin_notes?: string | null;
}

export interface SubscriptionBody {
  plan_key: string;
  months: number;
  start_date?: string;
  amount_paid: number;
  payment_method: PaymentMethod;
  payment_reference?: string | null;
  note?: string | null;
  offer_code?: string | null;
  kind?: RecordKind;
  /** Goodwill days on top of the months */
  extra_days?: number;
}

export interface SubscriptionRecorded extends SubscriptionRecord {
  paid_until: string;
}

export interface QuoteBody {
  plan_key: string;
  months: number;
  offer_code?: string | null;
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
  /** Why the offer code can't be used (null when it applies or none was given) */
  offer_error: string | null;
}

export interface BillingOption {
  months: number;
  /** null = monthly price x months */
  price: number | null;
  label?: string | null;
}

export interface PriceOption {
  months: number;
  price: number;
  label: string;
  per_month: number;
  /** Against paying monthly for the same months */
  saving: number;
}

export type DiscountType = 'percent' | 'flat' | 'none';

export interface SubscriptionOffer {
  id: string;
  code: string | null;
  name: string;
  description: string | null;
  discount_type: DiscountType;
  discount_value: number;
  extra_days: number;
  /** null = every plan */
  plan_keys: string[] | null;
  min_months: number;
  starts_at: string | null;
  ends_at: string | null;
  max_redemptions: number | null;
  redemptions: number;
  new_businesses_only: boolean;
  show_to_owners: boolean;
  is_active: boolean;
  /** e.g. "25% off on 12+ months" */
  summary: string;
}

export interface SubscriptionOfferBody {
  name: string;
  description?: string | null;
  code?: string | null;
  discount_type: DiscountType;
  discount_value: number;
  extra_days: number;
  plan_keys?: string[] | null;
  min_months: number;
  starts_at?: string | null;
  ends_at?: string | null;
  max_redemptions?: number | null;
  new_businesses_only: boolean;
  show_to_owners: boolean;
  is_active: boolean;
}

export type PaymentRequestStatus = 'pending' | 'approved' | 'rejected';

export interface PaymentRequest {
  id: string;
  business_id: string;
  business_name: string;
  plan_key: string;
  months: number;
  offer_code: string | null;
  /** What the owner says they paid */
  amount: number;
  method: PaymentMethod;
  reference: string | null;
  note: string | null;
  status: PaymentRequestStatus;
  requested_by: string | null;
  reviewed_by: string | null;
  review_note: string | null;
  created_at: string;
  reviewed_at: string | null;
  /** Pending only: what the plan + months + offer cost now */
  expected_amount?: number;
  offer_error?: string | null;
}

export interface DeviceSession {
  id: string;
  user_id: string;
  staff_id: string | null;
  name: string | null;
  email: string | null;
  role: string | null;
  device: string;
  ip: string | null;
  kind: string;
  created_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
  revoked_reason: string | null;
}

export interface PaymentDetails {
  upi_id: string;
  payee_name: string;
  bank_details: string;
  support_phone: string;
  support_email: string;
  instructions: string;
}

export interface PlatformSettings {
  /** Free demo for new businesses; 0 = none */
  trial_days: number;
  /** Days a business keeps working after its paid period ends */
  grace_days: number;
  /** Days before the end when owners are reminded */
  reminder_days: number;
  payment: PaymentDetails;
}

export interface JobsInfo {
  subscription_check: {
    schedule: string;
    next_run_at: string;
    last_run: SubscriptionCheckRun | null;
    enabled: boolean;
  };
}

export type BillStatus = 'placed' | 'open' | 'completed' | 'cancelled' | 'merged';

/** A business's bill as the console's records search shows it. */
export interface AdminBill {
  id: string;
  code: string;
  invoice_no: string | null;
  status: BillStatus;
  total: number;
  customer_name: string | null;
  channel: string | null;
  created_at: string;
  archived: boolean;
  archived_reason: string | null;
}

export type RecordsAction = 'archive' | 'unarchive' | 'delete';

export interface RecordsResult {
  archive?: number;
  unarchive?: number;
  delete?: number;
  /** Set when deleted bills were tax invoices (gaps in the invoice series) */
  warning: string | null;
}

export type OwnerRequestStatus = 'pending' | 'done' | 'rejected';
export type OwnerRequestKind = 'archive_bills' | 'delete_bills' | 'other';

export interface OwnerRequest {
  id: string;
  business_id: string;
  business_name: string;
  kind: OwnerRequestKind;
  order_ids: string[];
  message: string;
  status: OwnerRequestStatus;
  requested_by: string | null;
  handled_by: string | null;
  action_taken: 'archived' | 'deleted' | 'none' | null;
  response: string | null;
  created_at: string;
  handled_at: string | null;
}

export interface PlanInfo {
  key: string;
  name: string;
  description: string | null;
  price_monthly: number;
  features: string[];
  limits: Limits;
  is_active: boolean;
  sort_order: number;
  /** Businesses on this plan (not closed) */
  businesses: number;
  /** Explicit prices per duration (empty = monthly x 1/3/6/12) */
  billing_options: BillingOption[];
  /** How the plan can be bought, computed by the server */
  price_options: PriceOption[];
}

export interface PlansResponse {
  plans: PlanInfo[];
  features: FeatureInfo[];
}

export interface PlanBody {
  key: string;
  name: string;
  description?: string | null;
  price_monthly: number;
  features: string[];
  limits: Limits;
  is_active: boolean;
  sort_order: number;
  /** Empty or null = monthly price x months */
  billing_options?: BillingOption[] | null;
}

export interface TaxRateVersion {
  id: string;
  effective_from: string;
  total_rate: number;
  components: { name: string; rate: number }[];
  note: string | null;
  upcoming: boolean;
}

export interface TaxPreset {
  key: string;
  name: string;
  hsn_sac: string | null;
  description: string | null;
  is_active: boolean;
  current_rate: number | null;
  versions: TaxRateVersion[];
}

export interface TaxPresetBody {
  key: string;
  name: string;
  hsn_sac?: string | null;
  description?: string | null;
  rate: number;
  effective_from: string;
}

export interface TaxRateBody {
  rate: number;
  effective_from: string;
  note?: string | null;
}

export interface TaxRatePublished {
  preset: string;
  rate: number;
  effective_from: string;
  businesses_updated: number;
  classes_following: number;
}

export interface AuditEntry {
  id: string;
  actor_email: string;
  action: string;
  business_id: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

const P = '/platform';

/** Search and paging for the request inboxes (server max 500 a page). */
export interface RequestPage { q?: string; limit?: number; offset?: number }

export const platformApi = {
  me: () => api.get<PlatformMe>(`${P}/me`),
  overview: () => api.get<PlatformOverview>(`${P}/overview`),

  /** Server-paged; `access` filters by Tallyko access (locked = subscription ended, expiring = ends within 7 days). */
  businesses: (params: { q?: string; status?: BusinessStatus | null; plan?: string | null; access?: AccessFilter | null; limit?: number; offset?: number; withCounts?: boolean } = {}) =>
    api.get<BusinessList>(`${P}/businesses`, {
      query: { q: params.q?.trim() || undefined, status: params.status, plan: params.plan, access: params.access || undefined, limit: params.limit, offset: params.offset,
        with_counts: params.withCounts || undefined },
    }),
  business: (id: string) => api.get<BusinessDetail>(`${P}/businesses/${id}`),
  createBusiness: (body: BusinessCreateBody) => api.post<BusinessCreated>(`${P}/businesses`, body),
  updateBusiness: (id: string, body: BusinessUpdateBody) => api.put<BusinessDetail>(`${P}/businesses/${id}`, body),
  resetOwnerPassword: (id: string) => api.post<{ owner_email: string; temporary_password: string }>(`${P}/businesses/${id}/reset-owner-password`),
  recordSubscription: (id: string, body: SubscriptionBody) => api.post<SubscriptionRecorded>(`${P}/businesses/${id}/subscriptions`, body),
  quote: (id: string, body: QuoteBody) => api.post<Quote>(`${P}/businesses/${id}/quote`, body),
  giveDemo: (id: string, body: { days: number; plan_key?: string | null; note?: string | null }) =>
    api.post<SubscriptionRecorded | null>(`${P}/businesses/${id}/demo`, body),
  setDevelopment: (id: string, body: { enabled: boolean; note?: string | null }) => api.post<BusinessDetail>(`${P}/businesses/${id}/development`, body),
  sessions: (id: string, includeEnded = false) =>
    api.get<DeviceSession[]>(`${P}/businesses/${id}/sessions`, { query: { include_ended: includeEnded || undefined } }),
  signOutBusiness: (id: string, reason: string) => api.post<{ signed_out: number }>(`${P}/businesses/${id}/sign-out`, { reason }),
  revokeSession: (sessionId: string, reason: string) => api.post<{ signed_out: number }>(`${P}/sessions/${sessionId}/revoke`, { reason }),

  /** `ids` looks up exact bills (e.g. the ones an owner request names), up to 500. */
  businessBills: (id: string, params: { q?: string; status?: BillStatus | null; include_archived?: boolean; limit?: number; ids?: string[] } = {}) =>
    api.get<AdminBill[]>(`${P}/businesses/${id}/orders`, {
      query: { q: params.q?.trim() || undefined, status: params.status, include_archived: params.include_archived, limit: params.limit,
        ids: params.ids?.length ? params.ids.slice(0, 500).join(',') : undefined },
    }),
  /** Super admin only. Delete is permanent and needs confirm "DELETE". */
  billsAction: (id: string, action: RecordsAction, body: { order_ids: string[]; reason: string; confirm?: 'DELETE' }) =>
    api.post<RecordsResult>(`${P}/businesses/${id}/orders/${action}`, body),
  /** Newest first; `q` searches business, message and who asked. No total: a full page means there may be more. */
  ownerRequests: (status: OwnerRequestStatus | 'all' = 'pending', page: RequestPage = {}) =>
    api.get<OwnerRequest[]>(`${P}/owner-requests`, { query: { status, q: page.q?.trim() || undefined, limit: page.limit, offset: page.offset } }),
  /** Same, with the total (`X-Total-Count`) and requests per status (`X-Counts`, incl. `all`). */
  ownerRequestsPage: async (status: OwnerRequestStatus | 'all' = 'pending', page: RequestPage = {}) => {
    const { data, headers } = await api.getWithMeta<OwnerRequest[]>(`${P}/owner-requests`, { query: { status, q: page.q?.trim() || undefined, limit: page.limit, offset: page.offset } });
    return { items: data, total: headerNumber(headers, 'X-Total-Count'), counts: headerJson<Record<string, number>>(headers, 'X-Counts') };
  },
  resolveOwnerRequest: (id: string, body: { action: 'archive' | 'delete' | 'none'; response: string; confirm?: 'DELETE' }) =>
    api.post<{ status: OwnerRequestStatus } & Partial<RecordsResult>>(`${P}/owner-requests/${id}/resolve`, body),

  /** Newest first; `q` searches business, payment reference and who claimed. No total: a full page means there may be more. */
  paymentRequests: (status: PaymentRequestStatus | 'all' = 'pending', page: RequestPage = {}) =>
    api.get<PaymentRequest[]>(`${P}/subscription-requests`, { query: { status, q: page.q?.trim() || undefined, limit: page.limit, offset: page.offset } }),
  /** Same, with the total (`X-Total-Count`) and claims per status (`X-Counts`, incl. `all`). */
  paymentRequestsPage: async (status: PaymentRequestStatus | 'all' = 'pending', page: RequestPage = {}) => {
    const { data, headers } = await api.getWithMeta<PaymentRequest[]>(`${P}/subscription-requests`, { query: { status, q: page.q?.trim() || undefined, limit: page.limit, offset: page.offset } });
    return { items: data, total: headerNumber(headers, 'X-Total-Count'), counts: headerJson<Record<string, number>>(headers, 'X-Counts') };
  },
  /** `ignore_offer`: the claimed offer ended or is used up; approve at the amount paid without it. */
  approvePaymentRequest: (id: string, body: { note?: string | null; amount_paid?: number | null; ignore_offer?: boolean }) =>
    api.post<SubscriptionRecorded & { status: 'approved' }>(`${P}/subscription-requests/${id}/approve`, body),
  rejectPaymentRequest: (id: string, note: string) => api.post<{ status: 'rejected' }>(`${P}/subscription-requests/${id}/reject`, { note }),

  subscriptionOffers: () => api.get<SubscriptionOffer[]>(`${P}/subscription-offers`),
  createSubscriptionOffer: (body: SubscriptionOfferBody) => api.post<SubscriptionOffer>(`${P}/subscription-offers`, body),
  updateSubscriptionOffer: (id: string, body: SubscriptionOfferBody) => api.put<SubscriptionOffer>(`${P}/subscription-offers/${id}`, body),

  settings: () => api.get<PlatformSettings>(`${P}/settings`),
  saveSettings: (body: PlatformSettings) => api.put<PlatformSettings>(`${P}/settings`, body),
  jobs: () => api.get<JobsInfo>(`${P}/jobs`),
  runSubscriptionCheck: () => api.post<SubscriptionCheckRun & { locked_business_ids: string[] }>(`${P}/jobs/subscription-check`),

  plans: () => api.get<PlansResponse>(`${P}/plans`),
  savePlan: (body: PlanBody) => api.post<PlansResponse>(`${P}/plans`, body),

  taxPresets: () => api.get<TaxPreset[]>(`${P}/tax/presets`),
  createTaxPreset: (body: TaxPresetBody) => api.post<TaxPreset[]>(`${P}/tax/presets`, body),
  publishTaxRate: (key: string, body: TaxRateBody) => api.post<TaxRatePublished>(`${P}/tax/presets/${encodeURIComponent(key)}/rates`, body),

  audit: (params: { business_id?: string; limit?: number } = {}) => api.get<AuditEntry[]>(`${P}/audit`, { query: params }),
};
