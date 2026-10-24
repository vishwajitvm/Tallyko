/// <reference types="jest" />
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
import type { Order, OrderItem } from '@/api/types';
import { kotFromOrder, kotFromTicket, receiptFromOrder } from '@/lib/billing';
import { buildKotText, buildReceiptEscPos, buildReceiptHtml, buildReceiptText } from '../receipt';

const item = (over: Partial<OrderItem>): OrderItem => ({
  id: 'i', product_id: 'p', variant_id: null, name: 'Item', variant_name: null, quantity: 1, unit_price: 100, tax_rate: 5, tax_amount: 5,
  line_total: 100, notes: null, sent_to_kitchen: true, kot_id: 'k', kitchen_status: 'served', ...over,
});

const order: Order = {
  id: 'o1', code: 'O1CODE', invoice_no: 'INV/1', token_no: 4, type: 'DINE_IN', channel: 'POS', external_order_id: null, status: 'open',
  payment_status: 'unpaid', table_id: 't', table_label: '7', bill_label: 'Rahul', customer_id: null, brand_id: null, customer_name: null,
  customer_phone: null, delivery_address: null, notes: null, subtotal: 200, discount_amount: 0, tax_amount: 10, round_off: 0, total_amount: 210,
  paid_amount: 0, balance_due: 210, commission_amount: 0, loyalty_points_earned: 0, loyalty_points_redeemed: 0, cancel_reason: null,
  created_at: '2026-10-24T10:00:00Z', completed_at: null, payments: [], tax_breakup: [{ rate: 5, taxable: 200, cgst: 5, sgst: 5 }],
  items: [
    item({ id: 'a', name: 'Butter Naan', quantity: 2, line_total: 200 }),
    item({ id: 'b', name: 'Paneer Tikka', kitchen_status: 'void', is_void: true, void_reason: 'Changed mind', line_total: 0, tax_amount: 0 }),
    item({ id: 'c', name: 'Gulab Jamun', unit_price: 0, line_total: 0, tax_amount: 0, comp_reason: 'Birthday', comp_value: 80 }),
  ],
};

describe('receipt for a running bill with cancelled and free items', () => {
  const data = receiptFromOrder(order, null);

  it('leaves cancelled lines off the customer\'s bill', () => {
    expect(data.items.map((i) => i.name)).toEqual(['Butter Naan', 'Gulab Jamun']);
    for (const text of [buildReceiptText(data, 80), buildReceiptHtml(data, 80), buildReceiptText(data, 58)]) {
      expect(text).not.toContain('Paneer Tikka');
    }
  });

  it('prints on-the-house lines at 0 with "On the house"', () => {
    const comp = data.items.find((i) => i.name === 'Gulab Jamun')!;
    expect(comp).toMatchObject({ comp: true, unitPrice: 0, lineTotal: 0 });
    const text = buildReceiptText(data, 80);
    expect(text).toContain('On the house');
    expect(text).toMatch(/Gulab Jamun\s+1\s+-\s+0\.00/);
    expect(buildReceiptHtml(data, 58)).toContain('On the house');
    const bytes = buildReceiptEscPos(data, 58);
    expect(Buffer.from(bytes).toString('latin1')).toContain('On the house');
  });

  it('says which bill it is on a shared table', () => {
    expect(data.tableLabel).toBe('7 (Rahul)');
  });
});

describe('kitchen tickets', () => {
  it('skip cancelled lines and name the bill', () => {
    const kot = kotFromOrder(order);
    expect(kot.items.map((i) => i.name)).toEqual(['Butter Naan', 'Gulab Jamun']);
    expect(buildKotText(kot, 80)).toContain('BILL: Rahul');
  });

  it('reprinted tickets leave out cancelled lines', () => {
    const kot = kotFromTicket({
      id: 'k', kot_no: 12, status: 'preparing', order_id: 'o1', order_code: 'O1', token_no: null, type: 'DINE_IN', channel: 'POS', table_label: '7',
      brand: null, customer_name: null, notes: null, created_at: '2026-10-24T10:00:00Z', bill_label: 'Bill 2',
      items: [{ name: 'Dal', variant_name: null, quantity: 1, notes: null }, { name: 'Rice', variant_name: null, quantity: 1, notes: null, is_void: true }],
    });
    expect(kot.items.map((i) => i.name)).toEqual(['Dal']);
    expect(kot.billLabel).toBe('Bill 2');
  });
});
