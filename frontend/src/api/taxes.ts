/**
 * GST & taxes (backend/app/api/taxes.py): tax classes, dated rate changes, bulk assignment and the platform GST library.
 * Every mutating call returns the full overview again, so screens can replace their state in one step.
 */
import { api } from './client';

export type GstRegistration = 'regular' | 'composition' | 'unregistered';

export interface TaxComponent { name: string; rate: number }

/** One dated version of a class's rate. Issued bills keep the version that applied when they were made. */
export interface TaxRateVersion {
  id: string;
  /** ISO timestamp (UTC) */
  effective_from: string;
  total_rate: number;
  components: TaxComponent[];
  note: string | null;
  /** preset = copied from the Tallyko GST library; manual = set by the business */
  source: 'preset' | 'manual' | string;
  upcoming: boolean;
  current: boolean;
}

export interface TaxClass {
  id: string;
  name: string;
  code: string;
  hsn_sac: string | null;
  preset_key: string | null;
  /** Gets government rate changes from the Tallyko GST library automatically */
  follow_preset: boolean;
  is_active: boolean;
  is_default: boolean;
  /** Active items assigned to this class */
  products: number;
  current_rate: number | null;
  current_components: TaxComponent[];
  rates: TaxRateVersion[];
}

export interface TaxOverview {
  registration: GstRegistration;
  registration_types: Record<GstRegistration, string>;
  prices_include_tax: boolean;
  default_tax_class_id: string | null;
  /** Active items without a class (they use the default class) */
  products_without_class: number;
  classes: TaxClass[];
}

export interface TaxPreset {
  key: string;
  name: string;
  hsn_sac: string | null;
  description: string | null;
  current_rate: number | null;
}

export interface TaxClassCreate {
  name: string;
  hsn_sac?: string | null;
  /** Custom classes */
  rate?: number | null;
  /** Or copy a slab from the library */
  preset_key?: string | null;
  follow_preset?: boolean;
}

export interface TaxClassUpdate {
  name?: string;
  hsn_sac?: string | null;
  follow_preset?: boolean;
  is_active?: boolean;
}

export interface TaxRateSchedule {
  rate: number;
  /** ISO timestamp with offset; must not be in the past */
  effective_from: string;
  note?: string | null;
  /** Inter-state supplies only: charge the whole rate as IGST */
  igst_only?: boolean;
}

export interface TaxAssign {
  /** null = use the business default */
  tax_class_id: string | null;
  product_ids?: string[];
  category_ids?: string[];
  all_products?: boolean;
}

export const taxesApi = {
  overview: () => api.get<TaxOverview>('/taxes'),
  presets: () => api.get<TaxPreset[]>('/taxes/presets'),
  create: (body: TaxClassCreate) => api.post<TaxOverview>('/taxes', body),
  update: (id: string, body: TaxClassUpdate) => api.put<TaxOverview>(`/taxes/${id}`, body),
  scheduleRate: (id: string, body: TaxRateSchedule) => api.post<TaxOverview>(`/taxes/${id}/rates`, body),
  cancelRate: (id: string, rateId: string) => api.delete<TaxOverview>(`/taxes/${id}/rates/${rateId}`),
  assign: (body: TaxAssign) => api.post<{ updated: number }>('/taxes/assign', body),
};

// ---------------------------------------------------------------------------------------------------------------
// Helpers shared by the tax screens and the product editor
// ---------------------------------------------------------------------------------------------------------------

/** "5", "2.5", "0.125" — no trailing zeros. */
export function formatRate(rate: number | null | undefined): string {
  if (rate === null || rate === undefined || !Number.isFinite(rate)) return '–';
  return String(Number(rate.toFixed(3)));
}

/** Intra-state split, same as the server: CGST + SGST, half each. */
export function splitGst(total: number): TaxComponent[] {
  if (!total) return [];
  const half = Math.round((total / 2) * 1000) / 1000;
  return [{ name: 'CGST', rate: half }, { name: 'SGST', rate: half }];
}

/** "CGST 2.5% + SGST 2.5%", "IGST 18%", "No GST" */
export function describeComponents(components: TaxComponent[] | null | undefined, total?: number | null): string {
  const parts = (components ?? []).filter((c) => Number(c.rate) > 0);
  if (!parts.length) return total ? describeComponents(splitGst(total)) : 'No GST';
  return parts.map((c) => `${c.name} ${formatRate(Number(c.rate))}%`).join(' + ');
}

/** Rate versions newest first. */
export function sortedRates(rates: TaxRateVersion[]): TaxRateVersion[] {
  return [...rates].sort((a, b) => new Date(b.effective_from).getTime() - new Date(a.effective_from).getTime());
}

export function upcomingRates(c: TaxClass): TaxRateVersion[] {
  return [...c.rates].filter((r) => r.upcoming).sort((a, b) => new Date(a.effective_from).getTime() - new Date(b.effective_from).getTime());
}

// ---------------------------------------------------------------------------------------------------------------
// Small shared cache: the product editor reads classes often; the tax screen refreshes it after every change.
// ---------------------------------------------------------------------------------------------------------------

let overviewCache: { at: number; data: TaxOverview } | null = null;

export function cachedTaxOverview(maxAgeMs = 60_000): TaxOverview | null {
  return overviewCache && Date.now() - overviewCache.at < maxAgeMs ? overviewCache.data : null;
}

export function rememberTaxOverview(data: TaxOverview | null): void {
  overviewCache = data ? { at: Date.now(), data } : null;
}

/** GET /taxes, served from the cache when it is fresh. */
export async function loadTaxOverview(maxAgeMs = 60_000): Promise<TaxOverview> {
  const hit = cachedTaxOverview(maxAgeMs);
  if (hit) return hit;
  const data = await taxesApi.overview();
  rememberTaxOverview(data);
  return data;
}
