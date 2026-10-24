// Shapes returned by the Tallyko API (backend/app/api/*). Money is in rupees as numbers.

export type Role = 'owner' | 'manager' | 'cashier' | 'waiter' | 'kitchen';
export type OrderType = 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY' | 'RETAIL_WALKIN';
export type OrderStatus = 'placed' | 'open' | 'completed' | 'cancelled' | 'merged';
export type PaymentMethod = 'CASH' | 'CARD' | 'UPI' | 'WALLET' | 'AGGREGATOR' | 'CREDIT' | 'OTHER';
export type ChannelCode = 'POS' | 'QR' | 'ONLINE' | 'SWIGGY' | 'ZOMATO' | 'ONDC' | 'MAGICPIN' | 'OTHER';
export type BusinessType = 'restaurant' | 'retail' | 'cloud_kitchen' | 'cafe';

export type AccountType = 'business' | 'platform';
export type PlatformRole = 'super_admin' | 'support';

export interface AuthResponse {
  access_token: string;
  refresh_token: string;
  /** "platform" = Tallyko super admin / support (no business, no orders) */
  account_type?: AccountType;
  tenant_id: string | null;
  /** Business role key; built-in ones are typed, owners can also create custom roles */
  role: Role | null;
  platform_role?: PlatformRole | null;
  user: { id: string; email: string; full_name: string | null; role: Role | null; staff_id?: string | null } | null;
  business_name: string | null;
  /** The business's Tallyko subscription at sign-in (null for platform logins) */
  subscription?: SubscriptionState | null;
}

export type SubscriptionStateName = 'trial' | 'development' | 'active' | 'grace' | 'lapsed';
export interface SubscriptionState {
  state: SubscriptionStateName;
  kind?: 'trial' | 'paid' | 'complimentary' | 'development' | null;
  label?: string | null;
  paid_until: string | null;
  lock_at?: string;
  /** null for development access (no expiry) */
  days_left: number | null;
  locked: boolean;
}

/** What the signed-in staff member may see and do (GET /access/me). */
export interface AccessInfo {
  role: string;
  staff_id: string | null;
  name: string | null;
  permissions: string[];
  features: string[];
  plan: { key: string; name: string; limits: Record<string, number | null> };
}

export interface BusinessSettings {
  tenant_id: string;
  business_name: string;
  business_type: BusinessType;
  address: string | null;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  fssai: string | null;
  upi_id: string | null;
  currency_symbol: string;
  prices_include_tax: boolean;
  default_tax_rate: number;
  invoice_prefix: string;
  receipt_footer: string | null;
  loyalty_enabled: boolean;
  loyalty_points_per_100: number;
  loyalty_point_value: number;
  store_enabled: boolean;
  qr_ordering_enabled: boolean;
  low_stock_default: number;
  /** regular = tax invoice with GST; composition / unregistered = bill of supply without GST */
  gst_registration?: 'regular' | 'composition' | 'unregistered';
  /** Tax class used for items without their own class */
  default_tax_class_id?: string | null;
  /** Customer emails (rewards, offers, e-receipts) */
  email_enabled?: boolean;
  email_sender_name?: string | null;
  email_reply_to?: string | null;
  /** Floor alert minutes (Tables / Kitchen / Online colours). Missing keys use the defaults 45/75/10/20/3. */
  ops_thresholds?: Partial<OpsThresholds> | null;
}

export interface OpsThresholds {
  table_amber_min: number;
  table_red_min: number;
  kitchen_amber_min: number;
  kitchen_red_min: number;
  /** An online order waiting this long to be accepted turns amber; twice as long turns red. */
  online_wait_min: number;
}

export interface Category { id: string; name: string; sort_order: number; is_active: boolean }

export interface Variant { id: string; name: string; price: number }

export interface Product {
  id: string;
  name: string;
  description: string | null;
  base_price: number;
  cost_price: number | null;
  tax_rate: number | null;
  category_id: string | null;
  brand_id: string | null;
  barcode: string | null;
  sku: string | null;
  unit: string;
  is_veg: boolean | null;
  is_active: boolean;
  print_to_kitchen: boolean;
  track_stock: boolean;
  low_stock_threshold: number | null;
  sort_order: number;
  variants: Variant[];
  /** GST class (Settings › GST & taxes); null = business default (or the legacy tax_rate when set) */
  tax_class_id?: string | null;
  /** Per sales channel: {SWIGGY: {price: 260}, ZOMATO: {available: false}}; missing = the channel's % mark-up */
  channel_prices?: Partial<Record<ChannelCode, { price?: number; available?: boolean }>>;
}

export interface TableInfo {
  id: string;
  table_number: string;
  section: string | null;
  capacity: number;
  is_active: boolean;
  status?: 'free' | 'occupied';
  current_order?: { id: string; code: string; total_amount: number; status: OrderStatus; created_at: string; customer_name: string | null } | null;
  /** Every running bill on the table (shared tables / separate cheques), oldest first */
  open_bills?: TableBill[];
  assigned_staff_id?: string | null;
  /** Name of the assigned waiter (so roles that can't read /staff still see it). */
  assigned_staff_name?: string | null;
}

export type KitchenStatus = 'pending' | 'preparing' | 'ready' | 'served' | 'void';
export interface TableBill {
  id: string;
  code: string;
  bill_label: string | null;
  total_amount: number;
  status: OrderStatus;
  payment_status: string;
  guests: number | null;
  customer_name: string | null;
  waiter_id: string | null;
  waiter_name?: string | null;
  created_at: string;
  /** live kitchen lines per status, e.g. {pending: 2, ready: 1} */
  kitchen: Partial<Record<Exclude<KitchenStatus, 'void'>, number>>;
}

export interface SalesChannel {
  id: string;
  code: ChannelCode;
  name: string;
  enabled: boolean;
  commission_pct: number;
  price_adjust_pct: number;
  external_store_id: string | null;
  auto_accept: boolean;
  webhook_secret?: string;
}

export interface Brand { id: string; name: string; is_active: boolean }

export interface Customer {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  notes: string | null;
  points: number;
  tier: 'Bronze' | 'Silver' | 'Gold';
  total_spent: number;
  visits: number;
  last_visit_at: string | null;
  /** Customer agreed to receive offers by email */
  marketing_opt_in?: boolean;
}

export interface OrderItem {
  id: string;
  product_id: string;
  variant_id: string | null;
  name: string;
  variant_name: string | null;
  quantity: number;
  unit_price: number;
  tax_rate: number;
  tax_amount: number;
  line_total: number;
  notes: string | null;
  sent_to_kitchen: boolean;
  kot_id?: string | null;
  /** null = not a kitchen item */
  kitchen_status?: KitchenStatus | null;
  status_at?: string | null;
  /** cancelled line: kept for the record, never charged */
  is_void?: boolean;
  void_reason?: string | null;
  /** on the house: price 0, comp_value = what it would have cost */
  comp_reason?: string | null;
  comp_value?: number | null;
  /** added by a free-item offer */
  is_free?: boolean;
}

export interface Payment { id: string; method: PaymentMethod; amount: number; reference: string | null }

export interface TaxLine { rate: number; taxable: number; cgst: number; sgst: number; igst?: number }

export interface Order {
  id: string;
  code: string;
  invoice_no: string | null;
  token_no: number | null;
  type: OrderType;
  channel: ChannelCode;
  external_order_id: string | null;
  status: OrderStatus;
  payment_status: 'unpaid' | 'partial' | 'paid';
  table_id: string | null;
  table_label?: string | null;
  customer_id: string | null;
  brand_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  delivery_address: string | null;
  notes: string | null;
  subtotal: number;
  discount_amount: number;
  tax_amount: number;
  round_off: number;
  total_amount: number;
  paid_amount: number;
  balance_due: number;
  commission_amount: number;
  loyalty_points_earned: number;
  loyalty_points_redeemed: number;
  cancel_reason: string | null;
  created_at: string;
  completed_at: string | null;
  items: OrderItem[];
  payments: Payment[];
  tax_breakup: TaxLine[];
  change?: number;
  created?: boolean;
  /** "bill_of_supply" when the business charges no GST (composition / unregistered) */
  bill_type?: 'tax_invoice' | 'bill_of_supply';
  /** "inter" = inter-state supply, taxed as IGST */
  supply_type?: 'intra' | 'inter';
  offer_id?: string | null;
  offer_name?: string | null;
  /** Pre-tax amount taken off by the offer (part of discount_amount) */
  offer_discount?: number;
  /** Set by POST /orders/{id}/offer when an offer had to be dropped */
  warning?: string | null;
  /** tells bills on one table apart */
  bill_label?: string | null;
  guests?: number | null;
}

export interface OrderItemInput { product_id: string; variant_id?: string | null; quantity: number; notes?: string | null }
export interface PaymentInput { method: PaymentMethod; amount: number; reference?: string | null }
export interface DiscountInput { type: 'flat' | 'percent'; value: number }

export interface OrderCreateInput {
  id?: string;
  order_type: OrderType;
  channel?: ChannelCode;
  table_id?: string | null;
  customer_id?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  delivery_address?: string | null;
  notes?: string | null;
  brand_id?: string | null;
  external_order_id?: string | null;
  items: OrderItemInput[];
  discount?: DiscountInput | null;
  redeem_points?: number;
  payments?: PaymentInput[];
  send_to_kitchen?: boolean;
  created_at?: string;
  /** Apply this offer (the server re-checks eligibility and rejects the bill if it no longer applies) */
  offer_id?: string | null;
  /** Coupon code quoted by the customer */
  offer_code?: string | null;
  /** Let the server add the best auto-apply offer when none is chosen (server default: true) */
  auto_offers?: boolean;
}

export interface KitchenTicket {
  id: string;
  kot_no: number | null;
  status: 'pending' | 'preparing' | 'ready' | 'served' | 'cancelled';
  order_id: string;
  order_code: string;
  token_no: number | null;
  type: OrderType;
  channel: ChannelCode;
  table_label: string | null;
  brand: string | null;
  customer_name: string | null;
  notes: string | null;
  created_at: string;
  items: { name: string; variant_name: string | null; quantity: number; notes: string | null }[];
}

export interface StockRow {
  id: string;
  name: string;
  category_id: string | null;
  barcode: string | null;
  unit: string;
  stock: number;
  low_stock_threshold: number;
  is_low: boolean;
  cost_price: number | null;
  stock_value: number;
}

export interface StaffMember { id: string; email: string; full_name: string | null; role: Role; is_active: boolean }

export interface SalesSummary {
  from: string;
  to: string;
  orders: number;
  gross_sales: number;
  net_sales: number;
  tax: number;
  discounts: number;
  commission: number;
  round_off: number;
  average_order_value: number;
  cancelled_orders: number;
  cancelled_value: number;
  open_orders: number;
  open_value: number;
  by_payment: { method: PaymentMethod; amount: number; count: number }[];
  by_channel: { channel: ChannelCode; orders: number; amount: number; commission: number; net: number }[];
  by_type: { type: OrderType; orders: number; amount: number }[];
  hourly: number[];
  top_items: { name: string; quantity: number; revenue: number }[];
  by_category: { category: string; quantity: number; revenue: number }[];
}

export interface MenuScanItem {
  name: string;
  price: number | null;
  category: string | null;
  variants: { name: string; price: number }[];
  confidence: number;
}

export interface MenuScanResult { items: MenuScanItem[]; categories: string[]; lines: string[]; warnings: string[] }

export interface SyncPullResponse {
  server_time: string;
  full: boolean;
  settings: BusinessSettings;
  channels: SalesChannel[];
  categories: Category[];
  products: Product[];
  tables: TableInfo[];
  brands: Brand[];
  customers: Customer[];
  /** Tax classes with their dated rates, so the device previews the right GST offline */
  tax?: TaxSnapshot;
}

export interface TaxSnapshot {
  registration: 'regular' | 'composition' | 'unregistered';
  default_tax_class_id: string | null;
  classes: { id: string; name: string; is_active: boolean; rates: { effective_from: string; total_rate: number }[] }[];
}

export interface PublicMenu {
  business: { name: string; address: string | null; phone: string | null; currency_symbol: string; prices_include_tax: boolean; fssai: string | null };
  ordering: { store: boolean; qr: boolean };
  categories: { id: string; name: string }[];
  products: { id: string; name: string; description: string | null; price: number; category_id: string | null; is_veg: boolean | null; variants: Variant[] }[];
}
