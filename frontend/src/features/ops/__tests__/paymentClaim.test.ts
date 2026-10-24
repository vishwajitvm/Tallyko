/// <reference types="jest" />
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
import { paymentClaimOf } from '@/api/floor';
import { payChoice } from '../PaymentClaim';

describe('table QR payments', () => {
  it('reads how the customer said they will pay from the order notes', () => {
    expect(payChoice('Will pay by UPI')).toEqual({ label: 'Will pay by UPI', rest: null });
    expect(payChoice('No onion please\nWill pay at the counter')).toEqual({ label: 'Will pay at the counter', rest: 'No onion please' });
    expect(payChoice('Less spicy')).toBeNull();
    expect(payChoice(null)).toBeNull();
  });

  it('finds a "paid by UPI" claim on an order', () => {
    expect(paymentClaimOf({ payment_claim: { method: 'UPI', amount: 42, reference: '4123' } })).toMatchObject({ amount: 42 });
    expect(paymentClaimOf({ payment_claim: null })).toBeNull();
    expect(paymentClaimOf({})).toBeNull();
  });
});
