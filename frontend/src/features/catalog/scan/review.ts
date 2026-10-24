/**
 * Review-table model for scanned menu items: editable rows, problem detection, duplicate marking,
 * veg / non-veg guessing and conversion to the bulk-import payload.
 */
import type { MenuScanItem, Product } from '@/api/types';
import { localKey, moneyInput, normName, parseMoney, MAX_PRICE } from '../utils';

export const LOW_CONFIDENCE = 0.7;

export interface ReviewVariant { key: string; name: string; price: string }

export interface ReviewRow {
  key: string;
  include: boolean;
  name: string;
  category: string;
  price: string;
  variants: ReviewVariant[];
  confidence: number | null; // null = added by hand
  isVeg: boolean | null;
  existing: boolean; // already on the menu
}

export type RowProblem = 'name' | 'price' | 'variant' | 'tooLong';

/** "Main Course", "MAIN-COURSE" and "Maincourse" are the same category. */
export function categoryKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9ऀ-ॿ]/g, '');
}

/** Turns "MAIN COURSE" into "Main Course"; leaves mixed-case names alone. */
export function tidyCategory(name: string): string {
  const t = name.trim().replace(/\s+/g, ' ');
  if (t !== t.toUpperCase()) return t;
  return t.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

export function rowsFromScan(items: MenuScanItem[], existingNames: Set<string>, existingCategories: string[] = []): ReviewRow[] {
  const seen = new Set<string>();
  // Reuse the spelling of categories the business already has, so OCR quirks don't create near-duplicates
  const known = new Map(existingCategories.map((c) => [categoryKey(c), c.trim()]));
  const resolveCategory = (raw: string | null | undefined) => {
    const t = (raw ?? '').trim();
    if (!t) return '';
    return known.get(categoryKey(t)) ?? tidyCategory(t);
  };
  return items.map((it) => {
    const name = (it.name ?? '').trim();
    const key = normName(name);
    const existing = existingNames.has(key);
    const dupInScan = seen.has(key);
    seen.add(key);
    const variants = (it.variants ?? []).map((v) => ({ key: localKey('sv'), name: (v.name ?? '').trim(), price: moneyInput(v.price) }));
    return {
      key: localKey('r'),
      include: !existing && !dupInScan,
      name,
      category: resolveCategory(it.category),
      // With options the item price comes from them (the server sends the highest one as `price`)
      price: variants.length ? '' : moneyInput(it.price),
      variants,
      confidence: Number.isFinite(it.confidence) ? it.confidence : null,
      isVeg: guessVeg(name),
      existing,
    };
  });
}

export function blankRow(category = ''): ReviewRow {
  return { key: localKey('r'), include: true, name: '', category, price: '', variants: [], confidence: null, isVeg: null, existing: false };
}

export function rowProblems(row: ReviewRow): RowProblem[] {
  const out: RowProblem[] = [];
  const name = row.name.trim();
  if (!name) out.push('name');
  if (name.length > 120 || row.category.trim().length > 60) out.push('tooLong');
  if (row.variants.length) {
    const bad = row.variants.some((v) => !v.name.trim() || v.name.trim().length > 40 || parseMoney(v.price) === null || (parseMoney(v.price) ?? 0) > MAX_PRICE);
    if (bad) out.push('variant');
  } else {
    const p = parseMoney(row.price);
    if (p === null || p > MAX_PRICE) out.push('price');
  }
  return out;
}

export function problemText(problems: RowProblem[]): string | null {
  if (problems.includes('name')) return 'Add a name';
  if (problems.includes('price')) return 'Price missing — fill it in or untick';
  if (problems.includes('variant')) return 'Each option needs a name and price';
  if (problems.includes('tooLong')) return 'Name or category is too long';
  return null;
}

/** Names that appear more than once among included rows (the server would skip the repeats). */
export function duplicateKeys(rows: ReviewRow[]): Set<string> {
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (!r.include) continue;
    const k = normName(r.name);
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return new Set([...counts.entries()].filter(([, n]) => n > 1).map(([k]) => k));
}

const NON_VEG = /\b(chicken|chiken|murg|murgh|mutton|lamb|gosht|keema|kheema|fish|machli|machhi|prawn|prawns|jhinga|shrimp|crab|egg|eggs|anda|omelette|omelet|bhurji|meat|beef|pork|bacon|ham|sausage|salami|pepperoni|tuna|seafood|kebab|kabab|tikka\s+chicken|nalli|biryani\s+chicken|non[\s-]?veg)\b/i;
const VEG = /\b(paneer|veg|vegetable|aloo|gobi|dal|daal|dhal|rajma|chole|chana|palak|mushroom|bhindi|baingan|matar|malai\s+kofta|kofta|sabzi|sabji|jeera|rice|roti|naan|paratha|parantha|kulcha|tea|chai|coffee|lassi|juice|shake|ice\s*cream|kulfi|gulab|halwa|kheer|idli|dosa|uttapam|vada|sambar|poha|upma|pav\s*bhaji|samosa|kachori|pakoda|pakora|corn|cheese|margherita|salad|soup|curd|raita|papad|chaas|buttermilk|water|soda|cold\s*drink)\b/i;

/** Best guess from the name; null when unsure. Non-veg words win ("Egg Fried Rice" → non-veg). */
export function guessVeg(name: string): boolean | null {
  if (!name) return null;
  if (/\b(non[\s-]?veg)\b/i.test(name)) return false;
  if (NON_VEG.test(name)) return false;
  if (VEG.test(name)) return true;
  return null;
}

export interface ImportItem {
  name: string;
  price: number;
  category: string | null;
  variants: { name: string; price: number }[];
  tax_rate: number | null;
  is_veg: boolean | null;
}

export function toImportItems(rows: ReviewRow[], opts: { taxRate: number | null; applyVeg: boolean }): ImportItem[] {
  return rows
    .filter((r) => r.include && rowProblems(r).length === 0)
    .map((r) => {
      const variants = r.variants.map((v) => ({ name: v.name.trim(), price: parseMoney(v.price) ?? 0 }));
      const price = variants.length ? Math.min(...variants.map((v) => v.price)) : parseMoney(r.price) ?? 0;
      return {
        name: r.name.trim().replace(/\s+/g, ' '),
        price,
        category: r.category.trim() || null,
        variants,
        tax_rate: opts.taxRate,
        is_veg: opts.applyVeg ? r.isVeg : null,
      };
    });
}

export function existingNameSet(products: Product[]): Set<string> {
  return new Set(products.filter((p) => p.is_active).map((p) => normName(p.name)));
}
