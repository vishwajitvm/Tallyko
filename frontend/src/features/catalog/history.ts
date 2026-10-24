/** Pure helpers for the item history (menu versioning) timeline. */
import type { ProductSnapshot, ProductVersion } from '@/api/menuHistory';
import { money } from '@/lib/format';

/** Parses the server timestamp; tolerates "…+00:00Z" and missing zones (treated as UTC). */
export function parseWhen(iso: string): Date | null {
  if (!iso) return null;
  let t = Date.parse(iso);
  if (Number.isNaN(t)) t = Date.parse(iso.replace(/([+-]\d\d:\d\d)Z$/, '$1'));
  if (Number.isNaN(t)) t = Date.parse(`${iso}Z`);
  return Number.isNaN(t) ? null : new Date(t);
}

/** "Today, 3:05 pm", "Yesterday, 9:10 am", "12 Oct 2026, 6:00 pm". */
export function whenLabel(iso: string, now: Date = new Date()): string {
  const d = parseWhen(iso);
  if (!d) return '';
  const time = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (day === today) return `Today, ${time}`;
  if (today - day === 86_400_000) return `Yesterday, ${time}`;
  return `${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}, ${time}`;
}

const fmt = (n: number, symbol: string) => money(n, symbol, Number.isInteger(n));

/** Price shown for a version: "₹249" or "₹150 – ₹289" for items with options. */
export function snapshotPrice(s: ProductSnapshot, symbol = '₹'): string | null {
  const v = s.variants ?? [];
  if (v.length) {
    const prices = v.map(([, p]) => p);
    const lo = Math.min(...prices);
    const hi = Math.max(...prices);
    return lo === hi ? fmt(lo, symbol) : `${fmt(lo, symbol)} – ${fmt(hi, symbol)}`;
  }
  return typeof s.base_price === 'number' ? fmt(s.base_price, symbol) : null;
}

/** Price change from the previous (older) version, e.g. {from: "₹300", to: "₹340", up: true}; null when unchanged. */
export function priceDiff(current: ProductSnapshot, older: ProductSnapshot | null | undefined, symbol = '₹'): { from: string; to: string; up: boolean } | null {
  if (!older) return null;
  const a = snapshotPrice(older, symbol);
  const b = snapshotPrice(current, symbol);
  if (!a || !b || a === b) return null;
  const lo = (s: ProductSnapshot) => (s.variants?.length ? Math.min(...s.variants.map(([, p]) => p)) : s.base_price ?? 0);
  return { from: a, to: b, up: lo(current) >= lo(older) };
}

/** Readable facts about a version for the expanded timeline entry. */
export function snapshotFacts(s: ProductSnapshot, opts: { symbol?: string; categoryName?: (id: string) => string | undefined; channelName?: (code: string) => string | undefined } = {}): { label: string; value: string }[] {
  const symbol = opts.symbol ?? '₹';
  const out: { label: string; value: string }[] = [];
  if (s.name) out.push({ label: 'Name', value: s.name });
  const price = snapshotPrice(s, symbol);
  if (price) out.push({ label: 'Price', value: price });
  if (s.variants?.length) out.push({ label: 'Options', value: s.variants.map(([n, p]) => `${n} ${fmt(p, symbol)}`).join(' · ') });
  if (s.category_id !== undefined) out.push({ label: 'Category', value: s.category_id ? opts.categoryName?.(s.category_id) ?? 'Deleted category' : 'None' });
  const nameOf = (code: string) => opts.channelName?.(code) ?? (code.length <= 4 ? code : `${code.charAt(0)}${code.slice(1).toLowerCase()}`);
  const apps = Object.entries(s.channel_prices ?? {})
    .map(([code, e]) => (e?.available === false ? `Not on ${nameOf(code)}` : typeof e?.price === 'number' ? `${nameOf(code)} ${fmt(e.price, symbol)}` : null))
    .filter((x): x is string => !!x);
  if (apps.length) out.push({ label: 'App prices', value: apps.join(' · ') });
  if (s.is_active !== undefined) out.push({ label: 'On the menu', value: s.is_active ? 'Yes' : 'No (removed)' });
  return out;
}

/** The previous (older) version of each entry in a newest-first list. */
export function olderOf(list: ProductVersion[], index: number): ProductVersion | null {
  return list[index + 1] ?? null;
}
