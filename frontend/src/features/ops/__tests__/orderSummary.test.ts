/// <reference types="jest" />
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
import type { Order } from '@/api/types';
import { summaryFromOrder, type OrderSummaryRow } from '@/api/floor';

const row: OrderSummaryRow = {
  id: 'o1', code: 'A12', invoice_no: null, status: 'open', payment_status: 'unpaid', type: 'DINE_IN', channel: 'POS', external_order_id: null,
  token_no: null, table_id: 't1', table_label: '5', bill_label: null, customer_name: null, customer_phone: null, waiter_id: 'w1',
  waiter_name: 'Ravi', settled_by_name: null, total_amount: 300, discount_amount: 0, item_count: 3, payment_claim: null,
  created_at: '2026-10-24T10:00:00Z', completed_at: null,
};

describe('summaryFromOrder', () => {
  it('folds a full order into its light row, counting live lines only', () => {
    const order = {
      ...row, status: 'completed', payment_status: 'paid', invoice_no: 'INV-9', total_amount: 420, completed_at: '2026-10-24T11:00:00Z',
      table_label: null, waiter_name: undefined,
      items: [{ quantity: 2, kitchen_status: 'served' }, { quantity: 1, kitchen_status: 'void' }, { quantity: 3, kitchen_status: null }],
      payments: [],
    } as unknown as Order;
    const next = summaryFromOrder(row, order);
    expect(next).toMatchObject({ status: 'completed', payment_status: 'paid', invoice_no: 'INV-9', total_amount: 420, item_count: 5 });
    expect(next.table_label).toBe('5'); // the full order may not carry the names
    expect(next.waiter_name).toBe('Ravi');
  });
});
