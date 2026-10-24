/**
 * Customer-facing (no login) endpoints used by the store / table-QR page. Kept here, next to the screens, because they
 * carry QR-only fields (payment options, UPI link, per-item kitchen status) that the shared `publicApi` doesn't type.
 */
import { api } from '@/api/client';
import type { PublicMenu } from '@/api/types';
import type { OrderMode } from './model';

export interface QrPaymentOptions {
  counter: boolean;
  upi: boolean;
  upi_id: string | null;
  payee_name: string | null;
}

export type StoreMenu = Omit<PublicMenu, 'ordering'> & {
  ordering: { store: boolean; qr: boolean; qr_payment?: QrPaymentOptions };
};

export type PaymentChoice = 'counter' | 'upi';

export interface PublicOrderItem {
  name: string;
  variant_name: string | null;
  quantity: number;
  price?: number;
  line_total?: number;
  /** Kitchen status: null (not sent yet), pending, preparing, ready, served */
  status?: string | null;
}

export interface PaymentClaim {
  method: string;
  amount: number;
  reference: string | null;
  at: string;
}

export interface PublicOrder {
  id: string;
  code: string;
  status: 'placed' | 'open' | 'completed' | 'cancelled' | string;
  payment_status: string;
  total_amount: number;
  balance_due?: number;
  token_no: number | null;
  bill_label?: string | null;
  payment_claim?: PaymentClaim | null;
  payment_options?: QrPaymentOptions;
  upi_link?: string | null;
  items: PublicOrderItem[];
  subtotal?: number;
  tax_amount?: number;
  discount_amount?: number;
}

export interface PlaceOrderBody {
  id: string;
  source: OrderMode;
  order_type: 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY';
  table_id: string | null;
  customer_name: string;
  customer_phone: string;
  delivery_address: string | null;
  notes: string | null;
  payment?: PaymentChoice;
  items: { product_id: string; variant_id: string | null; quantity: number; notes: string | null }[];
}

const opts = { auth: false } as const;

export const storeApi = {
  menu: (tenantId: string, channel: OrderMode) => api.get<StoreMenu>(`/public/${tenantId}/menu`, { ...opts, query: { channel } }),
  table: (tenantId: string, tableId: string) => api.get<{ id: string; table_number: string }>(`/public/${tenantId}/tables/${tableId}`, opts),
  placeOrder: (tenantId: string, body: PlaceOrderBody) => api.post<PublicOrder>(`/public/${tenantId}/orders`, body, opts),
  order: (tenantId: string, orderId: string) => api.get<PublicOrder>(`/public/${tenantId}/orders/${orderId}`, opts),
  claimPayment: (tenantId: string, orderId: string, reference: string | null) =>
    api.post<PublicOrder>(`/public/${tenantId}/orders/${orderId}/payment-claim`, { reference }, opts),
};
