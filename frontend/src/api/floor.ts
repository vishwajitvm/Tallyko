/**
 * Running bills on the floor (backend/app/api/orders.py "Running bills" + kitchen tickets):
 * per-item kitchen status, cancel (void), on the house (comp), split / merge bills, bill name and guests.
 */
import { api } from './client';
import type { KitchenStatus, KitchenTicket, Order, OrderCreateInput } from './types';

/** Kitchen statuses a person can set on a line (void comes from cancelling). */
export type ItemStatus = Exclude<KitchenStatus, 'void'>;

/** A line (or part of it: `quantity` < the line's quantity). */
export interface ItemQty { item_id: string; quantity?: number | null }

/** POST /orders also takes these (several bills on one table). */
export interface BillCreateExtras {
  /** The table already has a bill: open another one next to it instead of answering 409. */
  new_bill?: boolean;
  bill_label?: string | null;
  guests?: number | null;
}
export type BillCreateInput = OrderCreateInput & BillCreateExtras;

export interface FloorTicketItem {
  id: string;
  name: string;
  variant_name: string | null;
  quantity: number;
  notes: string | null;
  status: KitchenStatus;
  is_void: boolean;
  void_reason: string | null;
}

/** GET /kitchen/tickets with item ids / per-line status and the bill label. */
export interface FloorTicket extends Omit<KitchenTicket, 'items'> {
  bill_label: string | null;
  items: FloorTicketItem[];
  /** `status=recent` only: when it was bumped (served) or cancelled. */
  bumped_at?: string | null;
}

/** The customer tapped "I've paid by UPI" on the table QR page; staff check the UPI app and confirm or reject. */
export interface PaymentClaim { method: 'UPI'; amount: number; reference?: string | null; at?: string | null }
/** Orders carry `payment_claim` (backend serialize_order). */
export type WithClaim<T> = T & { payment_claim?: PaymentClaim | null };

export function paymentClaimOf(order: object | null | undefined): PaymentClaim | null {
  const claim = (order as { payment_claim?: PaymentClaim | null } | null | undefined)?.payment_claim;
  return claim && typeof claim === 'object' ? claim : null;
}

export const floorApi = {
  createBill: (body: BillCreateInput) => api.post<Order>('/orders', body),
  /** Bills still open on a table (for bill tabs / "add to which bill?"). */
  tableBills: (tableId: string) =>
    api.get<{ items: Order[]; total: number }>('/orders', { query: { table_id: tableId, status: 'active', limit: 50 } }).then((r) => r.items),
  setItemsStatus: (orderId: string, itemIds: string[], status: ItemStatus) =>
    api.post<Order>(`/orders/${orderId}/items/status`, { item_ids: itemIds, status }),
  voidItems: (orderId: string, body: { items: ItemQty[]; reason?: string | null; waste?: boolean }) =>
    api.post<Order & { warning?: string | null }>(`/orders/${orderId}/items/void`, body),
  compItems: (orderId: string, body: { items: ItemQty[]; reason: string }) => api.post<Order>(`/orders/${orderId}/items/comp`, body),
  moveItems: (orderId: string, body: { items: ItemQty[]; target_order_id?: string | null; new_bill_label?: string | null }) =>
    api.post<{ source: Order; target: Order }>(`/orders/${orderId}/items/move`, body),
  /** Bring `sourceOrderId`'s items into `targetOrderId`; the source closes as "merged". */
  merge: (targetOrderId: string, sourceOrderId: string) => api.post<Order>(`/orders/${targetOrderId}/merge`, { source_order_id: sourceOrderId }),
  setDetails: (orderId: string, body: { bill_label?: string | null; guests?: number | null }) => api.put<Order>(`/orders/${orderId}/details`, body),
  /** Seen the money in the UPI app: records a UPI payment for the claimed amount (closes the bill if it covers it). */
  confirmClaim: (orderId: string) => api.post<WithClaim<Order>>(`/orders/${orderId}/payment-claim/confirm`),
  /** Money didn't arrive: the customer is asked to pay again or at the counter. */
  rejectClaim: (orderId: string, reason?: string | null) => api.post<WithClaim<Order>>(`/orders/${orderId}/payment-claim/reject`, { reason: reason || null }),
  /** `recent`: bumped or served in the last 2 hours, newest first (for Recall), with `bumped_at`. */
  tickets: (status: 'active' | 'ready' | 'all' | 'recent' = 'active') => api.get<FloorTicket[]>('/kitchen/tickets', { query: { status } }),
  setTicketStatus: (ticketId: string, status: KitchenTicket['status']) =>
    api.put<{ id: string; status: KitchenTicket['status'] }>(`/kitchen/tickets/${ticketId}/status`, { status }),
};

// ---------------------------------------------------------------- Floor operations screens (Orders / Tables / Kitchen / Online)

/** GET /orders also returns these (backend orders._serialize). */
export type OpsOrder = WithClaim<Order> & { waiter_id?: string | null; waiter_name?: string | null; settled_by_name?: string | null; bill_label?: string | null; guests?: number | null };

/** Every filter GET /orders understands (server-side paging and search). */
export interface OrderListQuery {
  status?: string;
  channel?: string;
  q?: string;
  date_from?: string;
  date_to?: string;
  table_id?: string;
  waiter_id?: string;
  /** Owners only: include bills Tallyko archived on request. */
  include_archived?: boolean;
  limit?: number;
  offset?: number;
}

/** GET /orders?summary=true: a light row for big lists (no lines or payments). */
export interface OrderSummaryRow {
  id: string;
  code: string;
  invoice_no: string | null;
  status: Order['status'];
  payment_status: Order['payment_status'];
  type: Order['type'];
  channel: Order['channel'];
  external_order_id: string | null;
  token_no: number | null;
  table_id: string | null;
  table_label: string | null;
  bill_label: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  waiter_id: string | null;
  waiter_name: string | null;
  settled_by_name: string | null;
  total_amount: number;
  discount_amount: number;
  /** Quantity on the bill, without cancelled lines. */
  item_count: number;
  payment_claim?: PaymentClaim | null;
  archived?: boolean;
  created_at: string;
  completed_at: string | null;
}

/** `with_counts=true`: bills per status for the same filters, plus `all` and `active` (placed + open). */
export type OrderStatusCounts = Partial<Record<string, number>>;

/** A full order folded into its list row (after an action in the detail panel). */
export function summaryFromOrder(row: OrderSummaryRow, order: Order): OrderSummaryRow {
  const o = order as OpsOrder;
  const live = (order.items ?? []).filter((i) => !['void', 'removed'].includes(String(i.kitchen_status ?? '')));
  return {
    ...row,
    code: o.code, invoice_no: o.invoice_no, status: o.status, payment_status: o.payment_status, type: o.type, channel: o.channel,
    external_order_id: o.external_order_id, token_no: o.token_no, table_id: o.table_id,
    table_label: o.table_label ?? row.table_label, bill_label: o.bill_label ?? row.bill_label,
    customer_name: o.customer_name, customer_phone: o.customer_phone,
    waiter_name: o.waiter_name ?? row.waiter_name, settled_by_name: o.settled_by_name ?? row.settled_by_name,
    total_amount: o.total_amount, discount_amount: o.discount_amount,
    item_count: order.items ? live.reduce((n, i) => n + (Number(i.quantity) || 0), 0) : row.item_count,
    payment_claim: o.payment_claim ?? null, completed_at: o.completed_at,
  };
}

type Query = Record<string, string | number | boolean | undefined>;

export const opsApi = {
  orders: (query: OrderListQuery) => api.get<{ items: OpsOrder[]; total: number }>('/orders', { query: query as Query }),
  /** Light rows + per-status counts in one call (the Orders screen). Counts are only asked for when `withCounts`. */
  orderSummaries: (query: OrderListQuery, withCounts = true) =>
    api.get<{ items: OrderSummaryRow[]; total: number; counts: OrderStatusCounts | null }>('/orders', {
      query: { ...query, summary: true, with_counts: withCounts || undefined } as Query,
    }),
  /** Staff for the "Assign waiter" picker (needs staff.view; managers). Names on tiles come with GET /tables. */
  staff: () => api.get<{ id: string; full_name: string | null; email: string; role: string; is_active: boolean }[]>('/staff'),
  assignWaiter: (tableId: string, staffId: string | null) => api.put<unknown>(`/tables/${tableId}`, { assigned_staff_id: staffId }),
};
