/// <reference types="jest" />
/**
 * Offline bills must survive the subscription lock (402) and forced sign-outs (401): they stay in the outbox,
 * untouched, and sync after renewal / the next sign-in.
 */
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => () => {}), fetch: jest.fn(async () => ({ isConnected: true })) }));
jest.mock('expo-secure-store', () => {
  const mem = new Map<string, string>();
  return {
    AFTER_FIRST_UNLOCK: 0,
    getItemAsync: jest.fn(async (k: string) => mem.get(k) ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => { mem.set(k, v); }),
    deleteItemAsync: jest.fn(async (k: string) => { mem.delete(k); }),
  };
});

import { useAuth, type Session } from '@/store/auth';
import { useOutbox, isPermanentRejection } from '@/store/outbox';
import { useSubscription } from '@/store/subscription';
import { syncNow } from '@/lib/sync';
import type { SubscriptionState } from '@/api/types';

const LAPSED = 'Your Tallyko subscription has ended. Renew to continue — your data and any offline bills are safe.';
const ACTIVE: SubscriptionState = { state: 'active', kind: 'paid', paid_until: '2099-01-01T00:00:00Z', days_left: 30, locked: false };

type Reply = { status: number; body: unknown };
let routes: Record<string, Reply> = {};
const calls: string[] = [];

function reply({ status, body }: Reply) {
  return { status, ok: status >= 200 && status < 300, text: async () => JSON.stringify(body) };
}

beforeAll(() => {
  (global as any).fetch = jest.fn(async (url: string) => {
    const path = url.replace(/^https?:\/\/[^/]+(\/api\/v\d+)?/, '');
    calls.push(path);
    const r = routes[path] ?? { status: 500, body: { success: false, error: { message: 'not mocked' } } };
    return reply(r);
  });
});

function session(tenantId = 't1'): Session {
  return {
    accessToken: 'access', refreshToken: 'refresh', accountType: 'business', platformRole: null, tenantId, role: 'cashier',
    userId: 'u1', email: 'cashier@example.com', fullName: 'Cashier', businessName: 'Cafe', subscription: ACTIVE,
  };
}

function bill(id: string, tenantId: string) {
  return { id, tenantId, payload: { id, items: [] } as any, preview: { total: 100, itemCount: 1, label: 'Takeaway' }, createdAt: new Date().toISOString() };
}

beforeEach(() => {
  routes = {};
  calls.length = 0;
  useAuth.setState({ status: 'signedIn', session: session(), signOutReason: null });
  useSubscription.getState().apply('t1', ACTIVE);
  useOutbox.setState({ queue: [], pushing: false });
  useOutbox.getState().enqueue(bill('b1', 't1'));
  useOutbox.getState().enqueue(bill('b2', 't1'));
  useOutbox.getState().enqueue(bill('x1', 't2'));
});

test('402 during push keeps every offline bill, locks the app and pauses pushing', async () => {
  routes['/sync/push'] = { status: 402, body: { success: false, error: { code: 'HTTP_ERROR', message: LAPSED } } };

  await syncNow();

  const queue = useOutbox.getState().queue;
  expect(queue.map((q) => q.id).sort()).toEqual(['b1', 'b2', 'x1']);
  expect(queue.every((q) => !q.failed && q.attempts === 0 && q.lastError === null)).toBe(true);
  expect(useSubscription.getState().locked).toBe(true);
  expect(useSubscription.getState().lockMessage).toBe(LAPSED);
  expect(useAuth.getState().status).toBe('signedIn'); // locked, not signed out

  // While locked nothing is pushed (no hammering the server, nothing marked failed)
  calls.length = 0;
  await syncNow();
  expect(calls).toEqual([]);
  expect(useOutbox.getState().queue).toHaveLength(3);
});

test('after renewal the queued bills of this business sync', async () => {
  routes['/sync/push'] = { status: 402, body: { success: false, error: { message: LAPSED } } };
  await syncNow();
  expect(useSubscription.getState().locked).toBe(true);

  // Tallyko approves the payment: GET /subscription says unlocked
  routes['/subscription'] = { status: 200, body: { ...ACTIVE, plans: [], offers: [], requests: [], history: [], payment: {}, can_pay: false, plan_key: 'pro', plan_name: 'Pro', grace_days: 0 } };
  await useSubscription.getState().refresh();
  expect(useSubscription.getState().locked).toBe(false);

  routes['/sync/push'] = { status: 200, body: { results: [{ id: 'b1', status: 'ok' }, { id: 'b2', status: 'ok' }] } };
  await syncNow();
  expect(useOutbox.getState().queue.map((q) => q.id)).toEqual(['x1']); // the other business's bill is untouched
});

test('a per-bill 402/401 from /sync/push is temporary, a 400 is permanent', async () => {
  expect(isPermanentRejection(402)).toBe(false);
  expect(isPermanentRejection(401)).toBe(false);
  expect(isPermanentRejection(429)).toBe(false);
  expect(isPermanentRejection(500)).toBe(false);
  expect(isPermanentRejection(400)).toBe(true);
  expect(isPermanentRejection(404)).toBe(true);

  routes['/sync/push'] = { status: 200, body: { results: [{ id: 'b1', status: 'error', code: 402, error: LAPSED }, { id: 'b2', status: 'error', code: 400, error: 'Item deleted' }] } };
  await syncNow();
  const byId = Object.fromEntries(useOutbox.getState().queue.map((q) => [q.id, q]));
  expect(byId.b1!.failed).toBe(false);
  expect(byId.b2!.failed).toBe(true);
  expect(Object.keys(byId).sort()).toEqual(['b1', 'b2', 'x1']);
});

test('forced sign-out (401, refresh refused) keeps the outbox and tells the user why', async () => {
  const signedOut = { status: 401, body: { success: false, error: { message: 'You were signed out of this device. Please sign in again.' } } };
  routes['/sync/push'] = signedOut;
  routes['/auth/refresh'] = signedOut;

  await syncNow();

  expect(useAuth.getState().status).toBe('signedOut');
  expect(useAuth.getState().signOutReason?.title).toBe('You were signed out by Tallyko');
  expect(useOutbox.getState().queue).toHaveLength(3);
  expect(useOutbox.getState().queue.every((q) => !q.failed)).toBe(true);
});
