/**
 * Small pure helpers shared by the Menu, Menu-scan and Inventory screens.
 */
import type { BusinessSettings, BusinessType, Category, Product, TaxSnapshot } from '@/api/types';
import { money } from '@/lib/format';
import { resolveTaxRate } from '@/lib/tax';

/** GST slabs offered as quick picks (backend accepts 0–28). */
export const GST_RATES = [0, 5, 12, 18, 28] as const;

export const MAX_PRICE = 1_000_000;

export const UNITS = ['pcs', 'plate', 'kg', 'g', 'L', 'ml', 'pack', 'box', 'dozen'] as const;

export const VARIANT_PRESETS: { label: string; names: string[] }[] = [
  { label: 'Half / Full', names: ['Half', 'Full'] },
  { label: 'Small / Medium / Large', names: ['Small', 'Medium', 'Large'] },
  { label: 'Regular / Large', names: ['Regular', 'Large'] },
];

/** Keeps only digits and one decimal point, at most 2 decimals and 7 integer digits. Never negative. */
export function sanitizeMoney(text: string): string {
  let t = text.replace(/,/g, '').replace(/[^0-9.]/g, '');
  const dot = t.indexOf('.');
  if (dot !== -1) t = t.slice(0, dot + 1) + t.slice(dot + 1).replace(/\./g, '');
  let [int = '', dec] = t.split('.');
  if (int.length > 1) int = int.replace(/^0+(?=\d)/, '');
  int = int.slice(0, 7);
  if (dec !== undefined) return `${int || '0'}.${dec.slice(0, 2)}`;
  return int;
}

/** Whole numbers only (stock quantities). Optional leading minus. */
export function sanitizeInt(text: string, allowNegative = false): string {
  const negative = allowNegative && text.trim().startsWith('-');
  let digits = text.replace(/[^0-9]/g, '').slice(0, 7);
  if (digits.length > 1) digits = digits.replace(/^0+(?=\d)/, '');
  return negative ? `-${digits}` : digits;
}

export function parseMoney(text: string | null | undefined): number | null {
  if (text === null || text === undefined) return null;
  const t = String(text).trim();
  if (!t || t === '.') return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

export function parseIntOrNull(text: string | null | undefined): number | null {
  if (text === null || text === undefined) return null;
  const t = String(text).trim();
  if (!t || t === '-') return null;
  const n = Number(t);
  return Number.isInteger(n) ? n : null;
}

/** For pre-filling inputs: 120 → "120", 99.5 → "99.5". */
export function moneyInput(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '';
  return String(Math.round(n * 100) / 100);
}

export function normName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Kitchen tickets make sense for food businesses only. */
export function kitchenDefault(businessType: BusinessType | null | undefined): boolean {
  return businessType !== 'retail';
}

export function isFoodBusiness(businessType: BusinessType | null | undefined): boolean {
  return businessType !== 'retail';
}

export function gstLabel(rate: number | null | undefined, defaultRate: number): string {
  if (rate === null || rate === undefined) return `${trimRate(defaultRate)}%`;
  return `${trimRate(rate)}%`;
}

/**
 * GST shown on a menu row: the item's tax class → its legacy rate → the business default class → settings default,
 * the same order the server uses. `tax` is GET /taxes (or the offline snapshot); `inherited` = the item has no rate of its own.
 */
export function itemGst(
  p: Pick<Product, 'tax_rate' | 'tax_class_id'>,
  tax: TaxSnapshot | null | undefined,
  settings: Pick<BusinessSettings, 'default_tax_rate'> | null | undefined,
): { label: string; inherited: boolean } {
  if (tax && tax.registration !== 'regular') return { label: 'No GST', inherited: true };
  const ownClass = !!p.tax_class_id && !!tax?.classes.some((c) => c.id === p.tax_class_id);
  const inherited = !ownClass && (p.tax_rate === null || p.tax_rate === undefined);
  return { label: `${trimRate(resolveTaxRate(p, tax, settings))}%`, inherited };
}

export function trimRate(rate: number): string {
  return Number.isInteger(rate) ? String(rate) : String(Math.round(rate * 100) / 100);
}

export function variantSummary(p: Pick<Product, 'variants'>, symbol = '₹'): string {
  if (!p.variants.length) return '';
  return p.variants.map((v) => `${v.name} ${money(v.price, symbol, Number.isInteger(v.price))}`).join(' · ');
}

/** Price label for a product row: "₹120" or "₹80 – ₹140" for items with options. */
export function priceLabel(p: Pick<Product, 'variants' | 'base_price'>, symbol = '₹'): string {
  const fmt = (n: number) => money(n, symbol, Number.isInteger(n));
  if (!p.variants.length) return fmt(p.base_price);
  const prices = p.variants.map((v) => v.price);
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  return lo === hi ? fmt(lo) : `${fmt(lo)} – ${fmt(hi)}`;
}

export function sortCategories(categories: Category[]): Category[] {
  return categories
    .filter((c) => c.is_active)
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
}

/** Barcode rules shared with the backend (max 48, letters/digits/space/-/.). */
export function barcodeError(code: string): string | null {
  const t = code.trim();
  if (!t) return null;
  if (t.length > 48) return 'Barcode can be at most 48 characters.';
  if (!/^[0-9A-Za-z\-. ]*$/.test(t)) return 'Use only letters, digits, spaces, dots and dashes.';
  return null;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

let keySeq = 0;
export function localKey(prefix = 'k'): string {
  keySeq += 1;
  return `${prefix}${Date.now().toString(36)}${keySeq}`;
}
