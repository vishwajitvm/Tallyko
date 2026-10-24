import type { Offer } from '@/api/offers';
import { offerCounts, offerMatches, offerPill, searchOffers, sortOffers, toggledState } from '../offerList';

const offer = (id: string, over: Partial<Offer> = {}): Offer => ({
  id, name: `Offer ${id}`, description: null, code: null, kind: 'bill', benefit_type: 'percent', benefit_value: 10, max_discount: null,
  free_product_id: null, free_quantity: 1, min_order_amount: 0, product_ids: [], category_ids: [], min_visits: null, visits_window_days: null,
  channels: null, order_types: null, days_of_week: null, start_time: null, end_time: null, starts_at: null, ends_at: null, auto_apply: true,
  is_active: true, priority: 0, max_uses_total: null, max_uses_per_customer: null, uses_count: 0, notify_email: false,
  summary: '10% off', state: 'live', redemptions: 0, ...over,
});

const list = [
  offer('1'), offer('2', { state: 'scheduled' }), offer('3', { state: 'off', is_active: false, code: 'DIWALI' }),
  offer('4', { state: 'expired' }), offer('5', { state: 'used_up', kind: 'loyalty' }),
];

describe('offer list', () => {
  it('counts every filter', () => {
    expect(offerCounts(list)).toEqual({ all: 5, live: 1, scheduled: 1, off: 1, ended: 2, loyalty: 1 });
    expect(list.filter((o) => offerMatches(o, 'ended')).map((o) => o.id)).toEqual(['4', '5']);
  });

  it('searches name, code and summary', () => {
    expect(searchOffers(list, 'diwali').map((o) => o.id)).toEqual(['3']);
    expect(searchOffers(list, '  ').length).toBe(5);
  });

  it('puts live offers first', () => {
    expect(sortOffers([list[3], list[2], list[0], list[1]]).map((o) => o.id)).toEqual(['1', '2', '3', '4']);
  });

  it('maps states to the shared status colours', () => {
    expect(offerPill('live')).toEqual({ status: 'active', label: 'Live' });
    expect(offerPill('scheduled').status).toBe('pending');
    expect(offerPill('used_up').label).toBe('Used up');
    expect(offerPill('off')).toEqual({ status: 'off', label: 'Off' });
  });

  it('switching updates the state at once', () => {
    expect(toggledState({ state: 'live' }, false)).toBe('off');
    expect(toggledState({ state: 'off' }, true)).toBe('live');
    expect(toggledState({ state: 'scheduled' }, true)).toBe('scheduled');
  });
});
