/** Pure helpers for the offers list: filter chips with counts, search and the StatusPill mapping (unit-tested). */
import type { Offer, OfferState } from '@/api/offers';

export type OfferFilter = 'all' | 'live' | 'scheduled' | 'off' | 'ended' | 'loyalty';

export function offerMatches(o: Offer, filter: OfferFilter): boolean {
  switch (filter) {
    case 'live': return o.state === 'live';
    case 'scheduled': return o.state === 'scheduled';
    case 'off': return o.state === 'off';
    case 'ended': return o.state === 'expired' || o.state === 'used_up';
    case 'loyalty': return o.kind === 'loyalty';
    default: return true;
  }
}

export function searchOffers(list: readonly Offer[], q: string): Offer[] {
  const t = q.trim().toLowerCase();
  if (!t) return [...list];
  return list.filter((o) => o.name.toLowerCase().includes(t) || (o.code ?? '').toLowerCase().includes(t) || o.summary.toLowerCase().includes(t));
}

export function offerCounts(list: readonly Offer[]): Record<OfferFilter, number> {
  const keys: OfferFilter[] = ['all', 'live', 'scheduled', 'off', 'ended', 'loyalty'];
  return Object.fromEntries(keys.map((k) => [k, list.filter((o) => offerMatches(o, k)).length])) as Record<OfferFilter, number>;
}

/** Live first, then scheduled, off, ended; newest name order inside a group. */
export function sortOffers(list: readonly Offer[]): Offer[] {
  const rank: Record<OfferState, number> = { live: 0, scheduled: 1, off: 2, used_up: 3, expired: 4 };
  return [...list].sort((a, b) => (rank[a.state] ?? 9) - (rank[b.state] ?? 9) || b.priority - a.priority || a.name.localeCompare(b.name));
}

/**
 * Offer state → the shared status colours (docs/20 §4): live = green, scheduled = amber (waiting to start),
 * off / expired = neutral, used up = red. Returns a StatusPill status + label.
 */
export function offerPill(state: OfferState): { status: string; label: string } {
  switch (state) {
    case 'live': return { status: 'active', label: 'Live' };
    case 'scheduled': return { status: 'pending', label: 'Scheduled' };
    case 'used_up': return { status: 'lapsed', label: 'Used up' };
    case 'expired': return { status: 'served', label: 'Expired' };
    default: return { status: 'off', label: 'Off' }; // neutral pill
  }
}

/** The state right after switching an offer on/off, before the server answers. */
export function toggledState(o: Pick<Offer, 'state'>, on: boolean): OfferState {
  if (!on) return 'off';
  return o.state === 'off' ? 'live' : o.state;
}
