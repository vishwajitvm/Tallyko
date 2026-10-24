/// <reference types="jest" />
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
import { ApiError } from '@/api/client';
import { EMPTY_DRAFT, type Draft } from '../cart';
import { buildCreatePayload, saveOnDevice } from '../totals';

describe('bills the server did not take are kept on this device', () => {
  it('keeps them when the connection is gone', () => {
    expect(saveOnDevice(new ApiError('Network request failed', 0, 'NETWORK', undefined, true))).toBe('offline');
  });

  it('keeps them when the subscription ends at that moment (402)', () => {
    expect(saveOnDevice(new ApiError('Your Tallyko plan has ended', 402, 'SUBSCRIPTION_LAPSED'))).toBe('lapsed');
  });

  it('shows real errors instead of hiding them in the outbox', () => {
    expect(saveOnDevice(new ApiError('Butter Naan is no longer on the menu', 400))).toBeNull();
    expect(saveOnDevice(new ApiError('Table 8 already has a running bill', 409))).toBeNull();
    expect(saveOnDevice(new ApiError('Forbidden', 403))).toBeNull();
    expect(saveOnDevice(new Error('boom'))).toBeNull();
  });

  it('queues the bill with the same idempotent id, so a replay never duplicates it', () => {
    const draft: Draft = {
      ...EMPTY_DRAFT, orderType: 'TAKEAWAY', draftId: 'bill-1',
      lines: [{ id: 'l', productId: 'p', variantId: null, name: 'Chai', variantName: null, price: 20, taxRate: 5, quantity: 2, notes: null }],
    };
    const payload = buildCreatePayload(draft, { id: 'bill-1', createdAt: '2026-10-24T10:00:00.000Z', sendToKitchen: true, offline: true,
      payments: [{ method: 'CASH', amount: 42 }] });
    expect(payload).toMatchObject({ id: 'bill-1', created_at: '2026-10-24T10:00:00.000Z', payments: [{ method: 'CASH', amount: 42 }], offer_id: null });
  });
});
