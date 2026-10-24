import {
  allowedPayments, balanceDue, billRoundOff, canOpenUpiApp, cleanUtr, isActiveTableOrder, itemStatus, paymentState, pickPayment, tableName,
  tableOrderKey, tableStage, utrError, type PlacedOrder,
} from '../model';

const order = (over: Partial<Parameters<typeof paymentState>[0]> = {}) => ({
  status: 'open', total_amount: 240, balance_due: 240, payment_status: 'unpaid', payment_claim: null, ...over,
});

describe('tableName', () => {
  it('prefixes plain numbers and keeps labels that already say Table', () => {
    expect(tableName('7')).toBe('Table 7');
    expect(tableName(' T4 ')).toBe('Table T4');
    expect(tableName('Table 9')).toBe('Table 9');
    expect(tableName('table-2')).toBe('table-2');
    expect(tableName('Tablet corner')).toBe('Table Tablet corner');
    expect(tableName('')).toBe('your table');
    expect(tableName(null)).toBe('your table');
  });
});

describe('payment options', () => {
  it('lists what the shop allows, counter first', () => {
    expect(allowedPayments({ counter: true, upi: true, upi_id: 'a@upi', payee_name: 'X' })).toEqual(['counter', 'upi']);
    expect(allowedPayments({ counter: false, upi: true, upi_id: 'a@upi', payee_name: 'X' })).toEqual(['upi']);
    expect(allowedPayments({ counter: true, upi: false, upi_id: null, payee_name: 'X' })).toEqual(['counter']);
  });

  it('never offers UPI without a UPI ID, and always offers something', () => {
    expect(allowedPayments({ counter: false, upi: true, upi_id: null, payee_name: null })).toEqual(['counter']);
    expect(allowedPayments(undefined)).toEqual(['counter']);
  });

  it('keeps the previous choice only while it is allowed', () => {
    expect(pickPayment(['counter', 'upi'], 'upi')).toBe('upi');
    expect(pickPayment(['counter'], 'upi')).toBe('counter');
    expect(pickPayment(['upi'], null)).toBe('upi');
  });
});

describe('tableStage', () => {
  it('follows the order through the kitchen', () => {
    expect(tableStage({ status: 'placed', items: [] })).toBe('waiting');
    expect(tableStage({ status: 'open', items: [{ name: 'Dosa', variant_name: null, quantity: 1, status: 'preparing' }] })).toBe('kitchen');
    expect(tableStage({ status: 'open', items: [] })).toBe('kitchen');
    expect(tableStage({
      status: 'open',
      items: [
        { name: 'Dosa', variant_name: null, quantity: 1, status: 'served' },
        { name: 'Tea', variant_name: null, quantity: 2, status: 'served' },
      ],
    })).toBe('served');
    expect(tableStage({
      status: 'open',
      items: [
        { name: 'Dosa', variant_name: null, quantity: 1, status: 'served' },
        { name: 'Water', variant_name: null, quantity: 1, status: null }, // never goes to the kitchen
      ],
    })).toBe('served');
    expect(tableStage({ status: 'open', items: [{ name: 'Water', variant_name: null, quantity: 1, status: null }] })).toBe('kitchen');
    expect(tableStage({ status: 'completed', items: [] })).toBe('done');
    expect(tableStage({ status: 'cancelled', items: [] })).toBe('cancelled');
  });
});

describe('itemStatus', () => {
  it('maps kitchen statuses to guest-friendly labels', () => {
    expect(itemStatus('preparing', 'open').label).toBe('Preparing');
    expect(itemStatus('ready', 'open').label).toBe('Ready');
    expect(itemStatus('served', 'open')).toEqual({ label: 'Served', tone: 'success' });
    expect(itemStatus('pending', 'open').label).toBe('In the kitchen');
    expect(itemStatus(null, 'placed').label).toBe('Waiting');
    expect(itemStatus(undefined, 'open').label).toBe('Ordered');
  });
});

describe('payment state', () => {
  it('is due until paid, claimed after "I have paid", paid once staff confirm', () => {
    expect(paymentState(order())).toBe('due');
    expect(paymentState(order({ payment_claim: { method: 'UPI', amount: 240, reference: null, at: '' } }))).toBe('claimed');
    expect(paymentState(order({ payment_status: 'paid', balance_due: 0, status: 'completed' }))).toBe('paid');
    expect(paymentState(order({ total_amount: 0, balance_due: 0 }))).toBe('nothing');
  });

  it('explains the rounding on the bill', () => {
    expect(billRoundOff({ total_amount: 74, subtotal: 70, tax_amount: 3.5, discount_amount: 0 })).toBe(0.5);
    expect(billRoundOff({ total_amount: 100, subtotal: 110, tax_amount: 0, discount_amount: 10 })).toBe(0);
    expect(billRoundOff({ total_amount: 73, subtotal: 70, tax_amount: 3.4 })).toBe(-0.4);
    expect(billRoundOff({ total_amount: 73 })).toBe(0);
  });

  it('falls back to the total when the server sends no balance', () => {
    expect(balanceDue({ total_amount: 120, payment_status: 'unpaid' })).toBe(120);
    expect(balanceDue({ total_amount: 120, payment_status: 'paid' })).toBe(0);
    expect(balanceDue({ total_amount: 120, balance_due: -3, payment_status: 'unpaid' })).toBe(0);
  });
});

describe('canOpenUpiApp', () => {
  it('uses the UPI deep link on phones and native apps, a QR code on desktop', () => {
    expect(canOpenUpiApp('android')).toBe(true);
    expect(canOpenUpiApp('ios')).toBe(true);
    expect(canOpenUpiApp('web', 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari')).toBe(true);
    expect(canOpenUpiApp('web', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe(true);
    expect(canOpenUpiApp('web', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140')).toBe(false);
    expect(canOpenUpiApp('web', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari', 0)).toBe(false);
    expect(canOpenUpiApp('web', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari', 5)).toBe(true); // iPadOS
  });
});

describe('UTR reference', () => {
  it('keeps letters and digits only and is optional', () => {
    expect(cleanUtr(' 4123 4567-8901 ')).toBe('412345678901');
    expect(cleanUtr('abc')).toBe('ABC');
    expect(cleanUtr('9'.repeat(60))).toHaveLength(40);
    expect(utrError('')).toBeNull();
    expect(utrError('412345678901')).toBeNull();
    expect(utrError('123')).toMatch(/too short/);
  });
});

describe('remembered table order', () => {
  const base: PlacedOrder = {
    id: 'o1', code: 'AB12', total_amount: 100, status: 'open', placedAt: new Date('2026-10-24T10:00:00Z').toISOString(), mode: 'QR',
  };
  const now = new Date('2026-10-24T11:00:00Z').getTime();

  it('is active while the bill is open and recent', () => {
    expect(isActiveTableOrder(base, now)).toBe(true);
    expect(isActiveTableOrder({ ...base, status: 'placed' }, now)).toBe(true);
    expect(isActiveTableOrder({ ...base, status: 'completed' }, now)).toBe(false);
    expect(isActiveTableOrder({ ...base, mode: 'ONLINE' }, now)).toBe(false);
    expect(isActiveTableOrder(base, now + 24 * 3600 * 1000)).toBe(false);
    expect(isActiveTableOrder(null, now)).toBe(false);
  });

  it('is stored per table', () => {
    expect(tableOrderKey('t1', 'a')).not.toBe(tableOrderKey('t1', 'b'));
  });
});
