/**
 * Owner's watch (backend/app/api/owner.py): everything that took money off the table and who did it, plus requests to
 * Tallyko for archiving / deleting records. Owner only — the server answers 403 for anyone else.
 */
import { api } from './client';
import type { Order } from './types';

export interface WatchTotals {
  cancelled_bills: number;
  cancelled_bills_value: number;
  /** Items cancelled after the kitchen had them (quantity) */
  items_cancelled: number;
  items_cancelled_value: number;
  /** Items removed before they were sent to the kitchen (quantity) */
  items_removed: number;
  items_removed_value: number;
  on_the_house: number;
  on_the_house_value: number;
  discounted_bills: number;
  discount_value: number;
  menu_changes: number;
}

export interface WatchStaffRow {
  /** null = unknown / system */
  staff_id: string | null;
  name: string;
  cancelled_bills: number;
  cancelled_bills_value: number;
  items_cancelled: number;
  items_cancelled_value: number;
  items_removed: number;
  items_removed_value: number;
  discounts: number;
  discount_value: number;
}

export interface WatchCancelledBill {
  id: string;
  bill: string;
  total: number;
  reason: string | null;
  by: string | null;
  table_id: string | null;
  created_at: string;
  cancelled_at: string;
}

export interface WatchItem {
  order_id: string;
  bill: string;
  bill_status: string;
  name: string;
  variant: string | null;
  quantity: number;
  value: number;
  /** true = cancelled after the kitchen had it; false = removed before it was sent */
  after_kitchen: boolean;
  reason: string | null;
  by: string | null;
  by_staff_id: string | null;
  at: string | null;
}

export interface WatchComp {
  order_id: string;
  bill: string;
  name: string;
  quantity: number;
  value: number;
  reason: string | null;
}

export interface WatchMenuChange {
  product_id: string;
  name: string;
  version: number;
  /** e.g. "Price ₹300 → ₹340" */
  change: string;
  changed_by: string | null;
  changed_by_staff_id: string | null;
  created_at: string;
}

export interface WatchEvent {
  id: string;
  action: string;
  label: string;
  by: string | null;
  by_staff_id: string | null;
  summary: string | null;
  details: Record<string, unknown> | null;
  at: string;
}

export interface OwnerWatch {
  from: string;
  to: string;
  totals: WatchTotals;
  by_staff: WatchStaffRow[];
  cancelled_bills: WatchCancelledBill[];
  items: WatchItem[];
  on_the_house: WatchComp[];
  menu_changes: WatchMenuChange[];
  /** One page of the activity log (newest first); `events_total` is the whole period (page on with `offset`). */
  events: WatchEvent[];
  events_total?: number;
}

export type OwnerRequestKind = 'archive_bills' | 'delete_bills' | 'other';

export interface OwnerRequest {
  id: string;
  kind: OwnerRequestKind;
  order_ids: string[];
  message: string;
  /** pending → done | rejected */
  status: 'pending' | 'done' | 'rejected' | string;
  /** archived | deleted | none */
  action_taken: string | null;
  /** Tallyko's reply */
  response: string | null;
  created_at: string;
  handled_at: string | null;
}

export const ownerApi = {
  watch: (q: { date_from?: string; date_to?: string; staff_id?: string | null; limit?: number; offset?: number }) =>
    api.get<OwnerWatch>('/owner/watch', { query: q }),
  requests: () => api.get<OwnerRequest[]>('/owner/requests'),
  ask: (body: { kind: OwnerRequestKind; order_ids: string[]; message: string }) => api.post<OwnerRequest>('/owner/requests', body),
  /** Bills for the request picker, including ones Tallyko already archived */
  bills: (q: { q?: string; status?: string; date_from?: string; date_to?: string; limit?: number }) =>
    api.get<{ items: Order[]; total: number }>('/orders', { query: { ...q, include_archived: true } }),
};
