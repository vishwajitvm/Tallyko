/**
 * Sales channels and per-channel menus (backend/app/api/admin.py "Sales channels" + catalog channel_prices).
 *
 * A product can carry its own price, or be hidden, per channel: `Product.channel_prices`
 * = {SWIGGY: {price: 289}, ZOMATO: {available: false}}. Without an entry the channel's `price_adjust_pct`
 * mark-up applies to the counter price. The server prices every bill; these calls only read and edit the menu.
 */
import { api } from './client';
import type { ChannelCode, Product, SalesChannel } from './types';

export type ChannelPriceEntry = { price?: number; available?: boolean };
export type ChannelPrices = Partial<Record<ChannelCode, ChannelPriceEntry>>;

/** item = the item's own price on this channel; markup = counter price + the channel's %; counter = same as the counter. */
export type ChannelPriceSource = 'item' | 'markup' | 'counter';

export interface ChannelMenuItem {
  id: string;
  name: string;
  category: string | null;
  is_veg: boolean | null;
  counter_price: number;
  /** Base price on this channel (options add their extra cost on top) */
  price: number;
  price_source: ChannelPriceSource;
  available: boolean;
  variants: { name: string; price: number }[];
}

export interface ChannelMenu {
  channel: SalesChannel;
  items: ChannelMenuItem[];
  available_count: number;
  hidden_count: number;
}

export const channelsApi = {
  list: () => api.get<SalesChannel[]>('/channels'),
  /** The menu as this channel sells it (GET /channels/{code}/menu). */
  menu: (code: ChannelCode | string) => api.get<ChannelMenu>(`/channels/${encodeURIComponent(code)}/menu`),
  update: (code: ChannelCode | string, body: Partial<SalesChannel>) => api.put<SalesChannel>(`/channels/${encodeURIComponent(code)}`, body),
  /** Replace an item's per-channel prices / availability. An empty object clears every override. */
  setProductPrices: (productId: string, channel_prices: ChannelPrices) =>
    api.put<Product>(`/catalog/products/${productId}`, { channel_prices }),
};
