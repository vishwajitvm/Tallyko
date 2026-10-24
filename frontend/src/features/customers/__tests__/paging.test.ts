import type { Customer } from '@/api/types';
import { filterCustomers, hasMorePages, lastVisitLabel, mergePage, searchCached, serverSort, serverSortDir, sortCustomers } from '../paging';

const c = (id: string, over: Partial<Customer> = {}): Customer => ({
  id, name: `Customer ${id}`, phone: `98000000${id}`, email: null, notes: null, points: 0, tier: 'Bronze', total_spent: 0, visits: 0,
  last_visit_at: null, marketing_opt_in: false, ...over,
});

describe('customer paging', () => {
  it('replaces on the first page and appends without duplicates', () => {
    expect(mergePage([c('1')], [c('2')], 0).map((x) => x.id)).toEqual(['2']);
    expect(mergePage([c('1'), c('2')], [c('2'), c('3')], 2).map((x) => x.id)).toEqual(['1', '2', '3']);
    expect(hasMorePages(100, 100)).toBe(true);
    expect(hasMorePages(37, 100)).toBe(false);
  });

  it('filters by tier and email consent, and sorts loaded rows', () => {
    const list = [c('1', { tier: 'Gold', total_spent: 900, marketing_opt_in: true }), c('2', { total_spent: 2000, visits: 9 }), c('3', { tier: 'Gold', points: 700 })];
    expect(filterCustomers(list, 'Gold').map((x) => x.id)).toEqual(['1', '3']);
    expect(filterCustomers(list, 'optin').map((x) => x.id)).toEqual(['1']);
    expect(sortCustomers(list, 'spend').map((x) => x.id)).toEqual(['2', '1', '3']);
    expect(sortCustomers(list, 'points').map((x) => x.id)[0]).toBe('3');
    expect(sortCustomers(list, 'recent').map((x) => x.id)).toEqual(['1', '2', '3']); // server order
  });

  it('maps list sorts to the server sort and its fixed direction', () => {
    expect(serverSort('spend')).toBe('spent');
    expect(serverSort('name')).toBe('name');
    expect(serverSort('visits')).toBe('visits');
    expect(serverSort('whatever')).toBe('recent');
    expect(serverSortDir('name')).toBe('asc');
    expect(serverSortDir('points')).toBe('desc');
  });

  it('searches the offline cache by name or phone digits', () => {
    const list = [c('1', { name: 'Riya Sharma', phone: '98765 43210' }), c('2', { name: 'Arjun Rao' })];
    expect(searchCached(list, 'riya').map((x) => x.id)).toEqual(['1']);
    expect(searchCached(list, '6543').map((x) => x.id)).toEqual(['1']);
    expect(searchCached(list, '').length).toBe(2);
  });

  it('labels the last visit', () => {
    const now = new Date('2026-10-24T12:00:00Z').getTime();
    expect(lastVisitLabel(null, now)).toBe('—');
    expect(lastVisitLabel('2026-10-24T08:00:00Z', now)).toBe('Today');
    expect(lastVisitLabel('2026-10-23T08:00:00Z', now)).toBe('Yesterday');
    expect(lastVisitLabel('2026-10-14T08:00:00Z', now)).toBe('10 days ago');
    expect(lastVisitLabel('2026-06-01T08:00:00Z', now)).toBe('4 mo ago');
  });
});
