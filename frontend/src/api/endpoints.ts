import { api, headerJson, headerNumber, request } from './client';
import type {
  AuthResponse, BusinessSettings, Brand, Category, Customer, KitchenTicket, MenuScanResult, Order, OrderCreateInput,
  OrderItemInput, PaymentInput, DiscountInput, Product, PublicMenu, SalesChannel, SalesSummary, StaffMember, StockRow,
  SyncPullResponse, TableInfo, BusinessType, Role, AccessInfo,
} from './types';

export const authApi = {
  login: (email: string, password: string, baseUrl?: string) =>
    api.post<AuthResponse>('/auth/login', { email, password }, { auth: false, baseUrl }),
  register: (body: { vendor_name: string; owner_name?: string; email: string; phone: string; password: string; business_type: BusinessType }, baseUrl?: string) =>
    api.post<AuthResponse>('/auth/register', body, { auth: false, baseUrl }),
  refresh: (refresh_token: string) => api.post<AuthResponse>('/auth/refresh', { refresh_token }, { auth: false }),
  me: () => api.get('/auth/me'),
  changePassword: (current_password: string, new_password: string) => api.post('/auth/change-password', { current_password, new_password }),
  deleteAccount: (password: string) => api.post<{ success: boolean; business_closed: boolean }>('/auth/delete-account', { password, confirm: 'DELETE' }),
};

export type BulkProductAction = 'price_set' | 'price_pct' | 'price_add' | 'category' | 'channel_hide' | 'channel_show' | 'remove' | 'restore';
export interface BulkProductsBody {
  product_ids: string[];
  action: BulkProductAction;
  value?: number;
  round_to_rupee?: boolean;
  category_id?: string | null;
  channel?: string;
}

export const catalogApi = {
  categories: () => api.get<Category[]>('/catalog/categories'),
  createCategory: (name: string) => api.post<Category>('/catalog/categories', { name }),
  updateCategory: (id: string, body: Partial<Category>) => api.put<Category>(`/catalog/categories/${id}`, body),
  deleteCategory: (id: string) => api.delete(`/catalog/categories/${id}`),
  products: (query?: { q?: string; category_id?: string; include_inactive?: boolean }) => api.get<Product[]>('/catalog/products', { query }),
  product: (id: string) => api.get<Product>(`/catalog/products/${id}`),
  byBarcode: (code: string) => api.get<Product>(`/catalog/products/by-barcode/${encodeURIComponent(code)}`),
  createProduct: (body: Record<string, unknown>) => api.post<Product>('/catalog/products', body),
  updateProduct: (id: string, body: Record<string, unknown>) => api.put<Product>(`/catalog/products/${id}`, body),
  deleteProduct: (id: string) => api.delete(`/catalog/products/${id}`),
  generateBarcode: (id: string) => api.post<Product>(`/catalog/products/${id}/barcode`),
  /**
   * One transaction for many items (up to 2,000); each changed item still gets a menu version.
   * Prices: `price_set` / `price_add` keep each option's own price, `price_pct` moves every option by the same %.
   * App prices (channel_prices with a price) are not covered: use PUT …/channel-prices per item.
   */
  bulkProducts: (body: BulkProductsBody) => api.post<{ updated: number; skipped: { id: string; reason: string }[] }>('/catalog/products/bulk', body, { timeoutMs: 60000 }),
  bulkImport: (items: { name: string; price: number; category?: string | null; variants?: { name: string; price: number }[]; tax_rate?: number | null; is_veg?: boolean | null }[], print_to_kitchen = true) =>
    api.post<{ created: number; skipped: string[] }>('/catalog/bulk-import', { items, print_to_kitchen, skip_duplicates: true }),
  scanMenu: (form: FormData) => request<MenuScanResult>('POST', '/ai/menu/extract', { form, timeoutMs: 120000 }),
};

export const ordersApi = {
  list: (query?: { status?: string; channel?: string; q?: string; date_from?: string; date_to?: string; table_id?: string; limit?: number; offset?: number }) =>
    api.get<{ items: Order[]; total: number }>('/orders', { query }),
  get: (id: string) => api.get<Order>(`/orders/${id}`),
  create: (body: OrderCreateInput) => api.post<Order>('/orders', body),
  addItems: (id: string, items: OrderItemInput[], send_to_kitchen = true) => api.post<Order>(`/orders/${id}/items`, { items, send_to_kitchen }),
  removeItem: (id: string, itemId: string) => api.delete<Order>(`/orders/${id}/items/${itemId}`),
  pay: (id: string, payments: PaymentInput[], discount?: DiscountInput | null, redeem_points?: number | null) =>
    api.post<Order>(`/orders/${id}/pay`, { payments, ...(discount ? { discount } : {}), ...(redeem_points ? { redeem_points } : {}) }),
  accept: (id: string) => api.post<Order>(`/orders/${id}/accept`),
  reject: (id: string, reason: string) => api.post<Order>(`/orders/${id}/reject`, { reason }),
  cancel: (id: string, reason: string) => api.post<Order>(`/orders/${id}/cancel`, { reason }),
  transfer: (id: string, table_id: string) => api.post<Order>(`/orders/${id}/transfer`, { table_id }),
  setCustomer: (id: string, body: { customer_id?: string | null; customer_name?: string | null; customer_phone?: string | null }) =>
    api.put<Order>(`/orders/${id}/customer`, body),
};

export const tablesApi = {
  list: () => api.get<TableInfo[]>('/tables'),
  create: (body: { table_number: string; section?: string | null; capacity?: number }) => api.post<TableInfo>('/tables', body),
  update: (id: string, body: Partial<TableInfo>) => api.put<TableInfo>(`/tables/${id}`, body),
  remove: (id: string) => api.delete(`/tables/${id}`),
};

export const kitchenApi = {
  tickets: (status: 'active' | 'ready' | 'all' = 'active') => api.get<KitchenTicket[]>('/kitchen/tickets', { query: { status } }),
  setStatus: (id: string, status: KitchenTicket['status']) => api.put(`/kitchen/tickets/${id}/status`, { status }),
};

export const inventoryApi = {
  list: () => api.get<StockRow[]>('/inventory'),
  lowStock: () => api.get<StockRow[]>('/inventory/low-stock'),
  logs: (product_id?: string) => api.get('/inventory/logs', { query: { product_id } }),
  adjust: (body: { product_id: string; quantity: number; reason: 'restock' | 'wastage' | 'adjustment' | 'return'; note?: string; unit_cost?: number }) =>
    api.post('/inventory/adjust', body),
};

export type CustomerServerSort = 'recent' | 'name' | 'points' | 'spent' | 'visits';
export type CustomerTierCounts = Partial<Record<Customer['tier'] | 'all' | 'opted_in', number>>;

export const crmApi = {
  list: (q?: string) => api.get<Customer[]>('/crm/customers', { query: { q } }),
  lookup: (phone: string) => api.get<Customer>('/crm/customers/lookup', { query: { phone } }),
  get: (id: string) => api.get<Customer & { orders: Pick<Order, 'id' | 'code' | 'invoice_no' | 'total_amount' | 'type' | 'channel' | 'status' | 'created_at'>[] }>(`/crm/customers/${id}`),
  create: (body: { name: string; phone: string; email?: string | null; notes?: string | null; marketing_opt_in?: boolean }) => api.post<Customer>('/crm/customers', body),
  update: (id: string, body: Partial<Customer>) => api.put<Customer>(`/crm/customers/${id}`, body),
  /**
   * One page (server limit 1–500), sorted and tier-filtered on the server. `total` is for these filters (X-Total-Count);
   * `counts` are per tier for the same search (X-Counts, before the tier filter).
   */
  page: async (query: { q?: string; limit: number; offset: number; sort?: CustomerServerSort; tier?: Customer['tier'] | null; opted_in?: boolean | null }) => {
    const { data, headers } = await api.getWithMeta<Customer[]>('/crm/customers', { query: { ...query, tier: query.tier ?? undefined, opted_in: query.opted_in ?? undefined } });
    return { items: data, total: headerNumber(headers, 'X-Total-Count'), counts: headerJson<CustomerTierCounts>(headers, 'X-Counts') };
  },
};

export const reportsApi = {
  summary: (date_from?: string, date_to?: string) => api.get<SalesSummary>('/reports/summary', { query: { date_from, date_to } }),
  items: (date_from?: string, date_to?: string) => api.get<{ name: string; variant: string | null; quantity: number; revenue: number; tax: number }[]>('/reports/items', { query: { date_from, date_to } }),
  staff: (date_from?: string, date_to?: string) => api.get<{ user_id: string | null; name: string; orders: number; amount: number }[]>('/reports/staff', { query: { date_from, date_to } }),
  wastage: (date_from?: string, date_to?: string) => api.get<{ product: string; quantity: number; cost: number }[]>('/reports/wastage', { query: { date_from, date_to } }),
};

export const adminApi = {
  settings: () => api.get<BusinessSettings>('/settings'),
  updateSettings: (body: Partial<BusinessSettings>) => api.put<BusinessSettings>('/settings', body),
  channels: () => api.get<SalesChannel[]>('/channels'),
  updateChannel: (code: string, body: Partial<SalesChannel>) => api.put<SalesChannel>(`/channels/${code}`, body),
  rotateChannelSecret: (code: string) => api.post<SalesChannel>(`/channels/${code}/rotate-secret`),
  brands: () => api.get<Brand[]>('/brands'),
  createBrand: (name: string) => api.post<Brand>('/brands', { name }),
  updateBrand: (id: string, body: { name: string; is_active: boolean }) => api.put<Brand>(`/brands/${id}`, body),
  staff: () => api.get<StaffMember[]>('/staff'),
  createStaff: (body: { full_name: string; email: string; phone?: string | null; role: Role; password: string }) => api.post<StaffMember>('/staff', body),
  updateStaff: (id: string, body: { full_name?: string; role?: Role; is_active?: boolean; password?: string }) => api.put<StaffMember>(`/staff/${id}`, body),
};

export const syncApi = {
  pull: (since: string | null) => api.post<SyncPullResponse>('/sync/pull', { since }),
  push: (orders: OrderCreateInput[]) =>
    api.post<{ results: { id: string | null; status: 'ok' | 'error'; created?: boolean; error?: string; code?: number; order?: Order }[] }>('/sync/push', { orders }, { timeoutMs: 60000 }),
};

export const publicApi = {
  menu: (tenantId: string) => api.get<PublicMenu>(`/public/${tenantId}/menu`, { auth: false }),
  table: (tenantId: string, tableId: string) => api.get<{ id: string; table_number: string }>(`/public/${tenantId}/tables/${tableId}`, { auth: false }),
  placeOrder: (tenantId: string, body: Record<string, unknown>) => api.post<{ id: string; code: string; status: string; total_amount: number; token_no?: number }>(`/public/${tenantId}/orders`, body, { auth: false }),
  orderStatus: (tenantId: string, orderId: string) => api.get(`/public/${tenantId}/orders/${orderId}`, { auth: false }),
};

export const healthApi = {
  check: (baseUrl: string) => request<{ status: string; version: string }>('GET', '', { auth: false, baseUrl: baseUrl.replace(/\/api\/v\d+$/, '') + '/health', timeoutMs: 8000 }),
};

export const accessApi = {
  me: () => api.get<AccessInfo>('/access/me'),
};
