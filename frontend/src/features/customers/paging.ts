/** Pure helpers for the server-paged customer list (no React, unit-tested). */
import type { Customer } from '@/api/types';

/** Append a page, dropping rows already shown (a customer can move pages when a new bill updates their last visit). */
export function mergePage<T extends { id: string }>(prev: readonly T[], page: readonly T[], offset: number): T[] {
  if (offset === 0) return [...page];
  const seen = new Set(prev.map((x) => x.id));
  return [...prev, ...page.filter((x) => !seen.has(x.id))];
}

/** A full page means the server may have more. */
export function hasMorePages(pageLength: number, limit: number): boolean {
  return pageLength >= limit;
}

export type CustomerSort = 'recent' | 'spend' | 'visits' | 'points' | 'name';

/** GET /crm/customers `sort` for a list sort key (the server sorts one way: name A→Z, the rest highest / latest first). */
export function serverSort(sort: string): 'recent' | 'name' | 'points' | 'spent' | 'visits' {
  if (sort === 'spend') return 'spent';
  return sort === 'name' || sort === 'points' || sort === 'visits' ? sort : 'recent';
}

/** The direction the server uses for a sort key. */
export function serverSortDir(sort: string): 'asc' | 'desc' {
  return sort === 'name' ? 'asc' : 'desc';
}
export type TierFilter = Customer['tier'] | 'all' | 'optin';

export function filterCustomers(list: readonly Customer[], tier: TierFilter): Customer[] {
  if (tier === 'all') return [...list];
  if (tier === 'optin') return list.filter((c) => !!c.marketing_opt_in);
  return list.filter((c) => c.tier === tier);
}

export function sortCustomers(list: readonly Customer[], sort: CustomerSort, dir: 'asc' | 'desc' = 'desc'): Customer[] {
  if (sort === 'recent' && dir === 'desc') return [...list]; // server order
  const sign = dir === 'desc' ? -1 : 1;
  const v = (c: Customer): number | string => {
    switch (sort) {
      case 'spend': return c.total_spent;
      case 'visits': return c.visits;
      case 'points': return c.points;
      case 'name': return c.name.toLowerCase();
      default: return c.last_visit_at ? new Date(c.last_visit_at).getTime() : 0;
    }
  };
  return [...list].sort((a, b) => {
    const x = v(a);
    const y = v(b);
    const c = typeof x === 'string' && typeof y === 'string' ? x.localeCompare(y) : (x as number) - (y as number);
    return c * sign || a.name.localeCompare(b.name);
  });
}

/** Offline search over the customers cached on this device. */
export function searchCached(list: readonly Customer[], q: string): Customer[] {
  const needle = q.trim().toLowerCase();
  const digits = q.replace(/\D/g, '');
  if (!needle) return [...list];
  return list.filter((c) => c.name.toLowerCase().includes(needle) || (!!digits && c.phone.replace(/\D/g, '').includes(digits)));
}

export function lastVisitLabel(iso: string | null, now = Date.now()): string {
  if (!iso) return '—';
  const days = Math.floor((now - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days} days ago`;
  if (days < 365) return `${Math.floor(days / 30)} mo ago`;
  return `${Math.floor(days / 365)} yr ago`;
}
