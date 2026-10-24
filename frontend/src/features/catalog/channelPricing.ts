/**
 * Per-channel menu prices (Swiggy, Zomato, ONDC, own store, QR): pure helpers shared by the item editor,
 * the menu list, the bulk "Set app prices" sheet and the channel menu view. They mirror
 * backend/app/services/channel_menu.py for previews only; the server prices every bill.
 */
import type { ChannelPrices, ChannelPriceEntry, ChannelPriceSource, ChannelMenu } from '@/api/channels';
import type { ChannelCode, Product, SalesChannel } from '@/api/types';
import { money, round2 } from '@/lib/format';

/** Channels that have a menu of their own. The counter (POS) and phone orders (OTHER) sell the counter menu. */
const MENU_ORDER: ChannelCode[] = ['SWIGGY', 'ZOMATO', 'ONDC', 'MAGICPIN', 'ONLINE', 'QR'];
const NOT_MENU: ChannelCode[] = ['POS', 'OTHER'];
const SHORT: Partial<Record<ChannelCode, string>> = { ONLINE: 'Online store', QR: 'QR menu', MAGICPIN: 'magicpin' };

export const MAX_CHANNEL_PRICE = 1_000_000;

const rank = (code: string) => {
  const i = MENU_ORDER.indexOf(code as ChannelCode);
  return i === -1 ? MENU_ORDER.length : i;
};

/** Enabled channels that can carry their own prices and menu, in a stable order (Swiggy, Zomato, ONDC, …, own store, QR). */
export function menuChannels(channels: SalesChannel[] | null | undefined): SalesChannel[] {
  return (channels ?? [])
    .filter((c) => c.enabled && !NOT_MENU.includes(c.code))
    .sort((a, b) => rank(a.code) - rank(b.code) || a.name.localeCompare(b.name));
}

/** Short label for badges and chips ("Swiggy", "Zomato", "Online store"). Renamed channels keep their name when it's short. */
export function channelShortName(c: Pick<SalesChannel, 'code' | 'name'>): string {
  if (c.name && c.name.length <= 12) return c.name;
  return SHORT[c.code] ?? c.name ?? c.code;
}

/** "+8%", "-5%", "" for 0. */
export function formatPct(pct: number | null | undefined): string {
  const n = Number(pct) || 0;
  if (!n) return '';
  const v = Number.isInteger(n) ? String(n) : String(round2(n));
  return n > 0 ? `+${v}%` : `${v}%`;
}

/** The channel's mark-up applied to a counter price. Like the server, a mark-up rounds to the nearest rupee
 * (apps list whole-rupee prices: ₹249 + 8% → ₹269); no mark-up keeps the counter price as is. */
export function markupPrice(counter: number, pct: number | null | undefined): number {
  const p = Number(pct) || 0;
  if (!p) return round2(counter);
  return Math.round(counter * (1 + p / 100) + 1e-9);
}

export function entryOf(prices: ChannelPrices | null | undefined, code: string): ChannelPriceEntry {
  if (!prices) return {};
  return (prices as Record<string, ChannelPriceEntry | undefined>)[code.toUpperCase()] ?? {};
}

export function isOnChannel(p: Pick<Product, 'channel_prices'>, code: string): boolean {
  return entryOf(p.channel_prices, code).available !== false;
}

export interface ChannelQuote {
  /** Base price on the channel */
  price: number;
  source: ChannelPriceSource;
  available: boolean;
  variants: { id: string; name: string; price: number }[];
}

/** What an item costs on a channel: its own price there (+ the option's extra), else the counter price with the channel's mark-up. */
export function channelQuote(
  p: Pick<Product, 'base_price' | 'variants' | 'channel_prices'>,
  channel: Pick<SalesChannel, 'code' | 'price_adjust_pct'>,
): ChannelQuote {
  const entry = entryOf(p.channel_prices, channel.code);
  const pct = Number(channel.price_adjust_pct) || 0;
  const own = typeof entry.price === 'number' && Number.isFinite(entry.price) ? entry.price : null;
  const at = (counter: number) => (own !== null ? round2(own + (counter - p.base_price)) : markupPrice(counter, pct));
  return {
    price: at(p.base_price),
    source: own !== null ? 'item' : pct ? 'markup' : 'counter',
    available: entry.available !== false,
    variants: p.variants.map((v) => ({ id: v.id, name: v.name, price: at(v.price) })),
  };
}

const fmt = (n: number, symbol: string) => money(n, symbol, Number.isInteger(n));

/** "₹289" or "₹150 – ₹289" for items with options. */
export function quoteLabel(q: Pick<ChannelQuote, 'price' | 'variants'>, symbol = '₹'): string {
  if (!q.variants.length) return fmt(q.price, symbol);
  const prices = q.variants.map((v) => v.price);
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  return lo === hi ? fmt(lo, symbol) : `${fmt(lo, symbol)} – ${fmt(hi, symbol)}`;
}

/** "Own price", "+8% mark-up", "Same as counter". */
export function sourceLabel(source: ChannelPriceSource, pct: number | null | undefined): string {
  if (source === 'item') return 'Own price';
  if (source === 'markup') return `${formatPct(pct)} mark-up`;
  return 'Same as counter';
}

/** Placeholder for an empty channel price field: "₹269 with Zomato's +8%" or "Same as counter (₹249)". */
export function markupPlaceholder(counter: number | null, channel: Pick<SalesChannel, 'code' | 'name' | 'price_adjust_pct'>, symbol = '₹'): string {
  const pct = Number(channel.price_adjust_pct) || 0;
  if (counter === null || !Number.isFinite(counter)) return pct ? `Counter price ${formatPct(pct)}` : 'Same as counter';
  if (!pct) return `Same as counter (${fmt(counter, symbol)})`;
  return `${fmt(markupPrice(counter, pct), symbol)} with ${channelShortName(channel)}'s ${formatPct(pct)}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Overrides: cleaning, editing drafts and bulk changes
// ---------------------------------------------------------------------------------------------------------------

/** Same rules as the server's clean_overrides: upper-case codes, keep a valid price and `available: false`, drop empty entries. */
export function cleanChannelPrices(raw: Record<string, Partial<ChannelPriceEntry> | null | undefined> | null | undefined): ChannelPrices {
  const out: Record<string, ChannelPriceEntry> = {};
  for (const [code, entry] of Object.entries(raw ?? {})) {
    if (!entry) continue;
    const clean: ChannelPriceEntry = {};
    const price = entry.price;
    if (typeof price === 'number' && Number.isFinite(price) && price >= 0) clean.price = round2(price);
    if (entry.available === false) clean.available = false;
    if (Object.keys(clean).length) out[code.toUpperCase()] = { ...(out[code.toUpperCase()] ?? {}), ...clean };
  }
  return out as ChannelPrices;
}

/** Set (or with null, clear) one channel's price; availability is kept. */
export function withChannelPrice(prices: ChannelPrices | null | undefined, code: string, price: number | null): ChannelPrices {
  const current = entryOf(prices, code);
  const next: Record<string, Partial<ChannelPriceEntry>> = { ...(prices ?? {}) };
  next[code.toUpperCase()] = { ...current, price: price === null ? undefined : price };
  return cleanChannelPrices(next);
}

export function samePrices(a: ChannelPrices | null | undefined, b: ChannelPrices | null | undefined): boolean {
  const ca = cleanChannelPrices(a);
  const cb = cleanChannelPrices(b);
  const keys = new Set([...Object.keys(ca), ...Object.keys(cb)]);
  for (const k of keys) {
    const x = entryOf(ca, k);
    const y = entryOf(cb, k);
    if (x.price !== y.price || (x.available !== false) !== (y.available !== false)) return false;
  }
  return true;
}

/** Editor state: one entry per channel that differs from "on the menu, mark-up price". */
export interface ChannelDraftEntry { price: string; available: boolean }
export type ChannelDraft = Record<string, ChannelDraftEntry>;

const moneyText = (n: number) => String(round2(n));

export function channelDraftFrom(prices: ChannelPrices | null | undefined): ChannelDraft {
  const out: ChannelDraft = {};
  for (const [code, entry] of Object.entries(cleanChannelPrices(prices))) {
    if (!entry) continue;
    out[code] = { price: entry.price === undefined ? '' : moneyText(entry.price), available: entry.available !== false };
  }
  return out;
}

export function draftEntry(draft: ChannelDraft, code: string): ChannelDraftEntry {
  return draft[code.toUpperCase()] ?? { price: '', available: true };
}

/** Immutable update that drops entries back to the default, so an untouched editor never looks changed. */
export function setDraftEntry(draft: ChannelDraft, code: string, patch: Partial<ChannelDraftEntry>): ChannelDraft {
  const key = code.toUpperCase();
  const next = { ...draftEntry(draft, key), ...patch };
  const out = { ...draft };
  if (!next.price.trim() && next.available) delete out[key];
  else out[key] = next;
  return out;
}

function parsePrice(text: string): number | null {
  const t = text.trim();
  if (!t || t === '.') return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? round2(n) : null;
}

/** Per-channel validation messages, keyed by code. */
export function channelDraftErrors(draft: ChannelDraft): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const [code, entry] of Object.entries(draft)) {
    if (!entry.available || !entry.price.trim()) continue;
    const n = parsePrice(entry.price);
    if (n === null) errors[code] = 'Enter a valid price.';
    else if (n > MAX_CHANNEL_PRICE) errors[code] = 'Price is too high.';
  }
  return errors;
}

/**
 * What the editor sends as `channel_prices`. Hidden channels keep a typed price so turning them back on restores it.
 * Entries for channels the editor doesn't show (turned off for now) come through untouched, because the draft
 * was built from every saved entry.
 */
export function channelPricesPayload(draft: ChannelDraft): ChannelPrices {
  const raw: Record<string, Partial<ChannelPriceEntry>> = {};
  for (const [code, entry] of Object.entries(draft)) {
    const price = parsePrice(entry.price);
    raw[code] = { ...(price !== null ? { price } : {}), ...(entry.available ? {} : { available: false }) };
  }
  return cleanChannelPrices(raw);
}

/** Bulk "+X% over counter price": the new per-item price for one item (base price; options keep their extra cost). */
export function bulkMarkup(counter: number, pct: number, roundToRupee: boolean): number {
  const raw = counter * (1 + pct / 100);
  return Math.max(0, roundToRupee ? Math.round(raw + 1e-9) : round2(raw));
}

// ---------------------------------------------------------------------------------------------------------------
// Menu list badges
// ---------------------------------------------------------------------------------------------------------------

export interface ChannelBadge { key: string; label: string; tone: 'info' | 'warning' | 'accent' | 'neutral' }

/** Small hints for a menu row: "Swiggy ₹289", "Not on Zomato", "Swiggy only", "Not at counter". */
export function channelBadges(p: Pick<Product, 'channel_prices'>, channels: Pick<SalesChannel, 'code' | 'name'>[], symbol = '₹'): ChannelBadge[] {
  const out: ChannelBadge[] = [];
  if (entryOf(p.channel_prices, 'POS').available === false) out.push({ key: 'pos', label: 'Not at counter', tone: 'neutral' });
  if (!channels.length) return out;
  const on = channels.filter((c) => isOnChannel(p, c.code));
  const off = channels.filter((c) => !isOnChannel(p, c.code));
  if (!on.length) {
    out.push({ key: 'none', label: channels.length === 1 ? `Not on ${channelShortName(channels[0])}` : 'Not on any app', tone: 'warning' });
  } else if (on.length === 1 && channels.length > 1) {
    out.push({ key: 'only', label: `${channelShortName(on[0])} only`, tone: 'accent' });
  } else if (off.length > 2) {
    out.push({ key: 'off', label: `Hidden on ${off.length} apps`, tone: 'warning' });
  } else {
    for (const c of off) out.push({ key: `off-${c.code}`, label: `Not on ${channelShortName(c)}`, tone: 'warning' });
  }
  const priced = on.filter((c) => typeof entryOf(p.channel_prices, c.code).price === 'number');
  if (priced.length > 2) {
    out.push({ key: 'priced', label: `Own price on ${priced.length} apps`, tone: 'info' });
  } else {
    for (const c of priced) {
      out.push({ key: `price-${c.code}`, label: `${channelShortName(c)} ${fmt(entryOf(p.channel_prices, c.code).price as number, symbol)}`, tone: 'info' });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Channel menu export (for the Swiggy / Zomato partner portal)
// ---------------------------------------------------------------------------------------------------------------

type Cell = string | number | null | undefined;

function csvCell(v: Cell): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'number' ? String(round2(v)) : v;
  // Neutralise spreadsheet formulas from item names; quote when needed
  const safe = typeof v === 'string' && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

const SOURCE_TEXT: Record<ChannelPriceSource, string> = { item: 'Own price', markup: 'Mark-up', counter: 'Same as counter' };

/** CSV of the whole channel menu (items on the menu first). BOM so Excel shows ₹ and Indian scripts correctly. */
export function channelMenuCsv(menu: ChannelMenu): string {
  const name = menu.channel.name;
  const rows: Cell[][] = [['Item', 'Category', 'Veg', 'Counter price', `${name} price`, 'Price source', `On ${name}`, 'Options']];
  const items = [...menu.items].sort((a, b) => Number(b.available) - Number(a.available));
  for (const i of items) {
    rows.push([
      i.name, i.category ?? '', i.is_veg === null ? '' : i.is_veg ? 'Veg' : 'Non-veg', i.counter_price, i.price,
      SOURCE_TEXT[i.price_source], i.available ? 'Yes' : 'No', i.variants.map((v) => `${v.name} ${round2(v.price)}`).join('; '),
    ]);
  }
  return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** Plain text to paste anywhere: "Item<TAB>price" per line (tab-separated, pastes into sheets), hidden items listed last. */
export function channelMenuText(menu: ChannelMenu, symbol = '₹'): string {
  const on = menu.items.filter((i) => i.available);
  const off = menu.items.filter((i) => !i.available);
  const lines = [`${menu.channel.name} menu (${on.length} item${on.length === 1 ? '' : 's'})`];
  for (const i of on) {
    lines.push(`${i.name}\t${money(i.price, symbol)}`);
    for (const v of i.variants) lines.push(`  ${v.name}\t${money(v.price, symbol)}`);
  }
  if (off.length) lines.push('', `Not on ${menu.channel.name}: ${off.map((i) => i.name).join(', ')}`);
  return lines.join('\n');
}
