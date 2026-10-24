/**
 * Menu versioning (backend/app/api/catalog.py "Menu history"): every change to an item is an append-only version.
 * Restoring an earlier version is itself recorded as a new version, so nothing is ever lost.
 */
import { api } from './client';
import type { Product } from './types';
import type { ChannelPrices } from './channels';

/** The item as it was saved in a version (server field names; ids as strings). */
export interface ProductSnapshot {
  name?: string;
  base_price?: number;
  cost_price?: number | null;
  category_id?: string | null;
  brand_id?: string | null;
  tax_class_id?: string | null;
  barcode?: string | null;
  sku?: string | null;
  unit?: string | null;
  is_veg?: boolean | null;
  print_to_kitchen?: boolean;
  track_stock?: boolean;
  is_active?: boolean;
  channel_prices?: ChannelPrices | null;
  description?: string | null;
  /** [name, price] pairs, sorted by name */
  variants?: [string, number][];
}

export interface ProductVersion {
  version: number;
  /** "Price ₹300 → ₹340", "Removed from the menu", "Created", "Restored version 1" */
  change: string;
  changed_by: string | null;
  changed_by_staff_id?: string | null;
  /** ISO timestamp (UTC) */
  created_at: string;
  snapshot: ProductSnapshot;
}

export const menuHistoryApi = {
  /** Newest first (at most 200). Needs menu.manage. */
  list: (productId: string) => api.get<ProductVersion[]>(`/catalog/products/${productId}/history`),
  /** Put the item back as it was in `version`; returns the product. */
  restore: (productId: string, version: number) => api.post<Product>(`/catalog/products/${productId}/history/${version}/restore`),
};
