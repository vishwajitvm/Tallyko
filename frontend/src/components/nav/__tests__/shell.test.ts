jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import { NAV_ITEMS, itemForGoKey, splitBottomBar, visibleNavItems } from '../navItems';
import { createGoSequence } from '../shortcuts';
import { isNoticeHidden, localDay } from '../navPrefs';
import { accessLine } from '../shellStatus';
import { searchSettings } from '@/features/settings/search';
import { SETTINGS_SECTIONS } from '@/features/settings/sections';
import { addRecent } from '@/features/auth/recentLogins';

describe('bottom bar', () => {
  it('shows four items plus More for an owner', () => {
    const items = visibleNavItems('owner', 'restaurant');
    const { bar, more } = splitBottomBar(items);
    expect(bar.map((i) => i.route)).toEqual(['pos', 'orders', 'tables', 'kitchen']);
    expect(more.map((i) => i.route)).toContain('settings');
    expect(bar.length + more.length).toBe(items.length);
  });

  it('fills the bar for retail, which has no tables or kitchen', () => {
    const { bar } = splitBottomBar(visibleNavItems('owner', 'retail'));
    expect(bar).toHaveLength(4);
    expect(bar.map((i) => i.route)).not.toContain('tables');
  });

  it('shows every item without More when five or fewer are visible', () => {
    const items = visibleNavItems('kitchen', 'restaurant');
    expect(splitBottomBar(items).more).toEqual([]);
  });
});

describe('go shortcuts', () => {
  it('maps g then a letter to a section', () => {
    expect(itemForGoKey(NAV_ITEMS, 'b')?.route).toBe('pos');
    expect(itemForGoKey(NAV_ITEMS, 'O')?.route).toBe('orders');
    expect(itemForGoKey(NAV_ITEMS, 'z')).toBeUndefined();
  });

  it('completes g + key typed by a person', () => {
    const next = createGoSequence();
    expect(next('g', 1000)).toBeNull();
    expect(next('b', 1300)).toBe('b');
  });

  it('ignores scanner-fast bursts and stale sequences', () => {
    const next = createGoSequence();
    expect(next('8', 1000)).toBeNull();
    expect(next('g', 1005)).toBeNull();
    expect(next('b', 1010)).toBeNull();
    const slow = createGoSequence();
    slow('g', 1000);
    expect(slow('b', 4000)).toBeNull();
  });
});

describe('subscription notice', () => {
  it('stays hidden only for the day it was hidden', () => {
    const today = new Date(2026, 9, 24, 15);
    expect(isNoticeHidden({ k: localDay(today) }, 'k', today)).toBe(true);
    expect(isNoticeHidden({ k: localDay(today) }, 'k', new Date(2026, 9, 25, 9))).toBe(false);
  });

  it('describes access quietly', () => {
    expect(accessLine({ state: 'development' } as never)?.label).toBe('Development access');
    const now = Date.UTC(2026, 9, 24);
    expect(accessLine({ state: 'trial', paid_until: new Date(now + 3 * 86_400_000).toISOString() } as never, now)?.label).toBe('Free demo · 3 days left');
    expect(accessLine({ state: 'active', paid_until: new Date(now + 90 * 86_400_000).toISOString() } as never, now)).toBeNull();
  });
});

describe('search settings', () => {
  it('finds settings by everyday words', () => {
    expect(searchSettings('upi', SETTINGS_SECTIONS)[0]?.href).toBe('/settings/business?section=payments');
    expect(searchSettings('gst', SETTINGS_SECTIONS).map((t) => t.section)).toEqual(expect.arrayContaining(['business', 'taxes']));
    expect(searchSettings('printer', SETTINGS_SECTIONS)[0]?.section).toBe('printers');
    expect(searchSettings('swiggy', SETTINGS_SECTIONS)[0]?.section).toBe('channels');
  });

  it('only offers sections the person can open', () => {
    const cashier = SETTINGS_SECTIONS.filter((s) => ['overview', 'printers', 'account'].includes(s.key));
    expect(searchSettings('upi', cashier).map((t) => t.section)).toEqual(['printers']);
    expect(searchSettings('password', cashier)[0]?.section).toBe('account');
  });
});

describe('recent logins', () => {
  it('keeps the latest first, without duplicates, up to six', () => {
    let list = addRecent([], { email: 'a@x.com', name: 'A', business: null }, 1);
    list = addRecent(list, { email: 'b@x.com', name: 'B', business: null }, 2);
    list = addRecent(list, { email: 'A@x.com', name: 'A', business: null }, 3);
    expect(list.map((r) => r.email)).toEqual(['A@x.com', 'b@x.com']);
    for (let i = 0; i < 10; i++) list = addRecent(list, { email: `${i}@x.com`, name: null, business: null }, 10 + i);
    expect(list).toHaveLength(6);
  });
});
