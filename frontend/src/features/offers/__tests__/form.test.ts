/// <reference types="jest" />
import type { Offer } from '@/api/offers';
import { emptyForm, fromOffer, previewSentence, toInput, validateForm } from '../form';

const PRODUCTS: Record<string, string> = { p1: 'Paneer Tikka', chai: 'Masala Chai' };
const names = { product: (id: string) => PRODUCTS[id], category: (id: string) => (id === 'c1' ? 'Starters' : undefined) };

describe('offer form validation', () => {
  it('needs a name and a sensible value', () => {
    const e = validateForm(emptyForm('bill'));
    expect(e.name).toBeTruthy();
    expect(e.value).toBeTruthy();
    expect(validateForm({ ...emptyForm('bill'), name: 'Happy hours', value: '20' })).toEqual({});
    expect(validateForm({ ...emptyForm('bill'), name: 'X1', value: '120' }).value).toMatch(/1 and 100/);
  });
  it('checks kind-specific fields', () => {
    expect(validateForm({ ...emptyForm('items'), name: 'Deal', value: '10' }).product_ids).toBeTruthy();
    expect(validateForm({ ...emptyForm('bill'), name: 'Deal', benefit_type: 'free_item' }).free_product_id).toBeTruthy();
    expect(validateForm({ ...emptyForm('loyalty'), name: 'Regulars', min_visits: '' }).min_visits).toBeTruthy();
    expect(validateForm(emptyForm('loyalty'))).toEqual({ name: expect.any(String) });
  });
  it('checks times, dates and codes', () => {
    const ok = { ...emptyForm('bill'), name: 'Late night', value: '10' };
    expect(validateForm({ ...ok, start_time: '22:00' }).end_time).toMatch(/both/);
    expect(validateForm({ ...ok, start_time: '22:00', end_time: '02:00' })).toEqual({}); // overnight is fine
    expect(validateForm({ ...ok, start_time: '25:00', end_time: '02:00' }).start_time).toBeTruthy();
    expect(validateForm({ ...ok, starts_on: '2026-11-30', ends_on: '2026-11-01' }).ends_on).toBeTruthy();
    expect(validateForm({ ...ok, starts_on: '2026-02-30' }).starts_on).toBeTruthy();
    expect(validateForm({ ...ok, code: 'HAS SPACE' }).code).toBeTruthy();
    expect(validateForm({ ...ok, code: 'DIWALI-20' })).toEqual({});
  });
});

describe('form to API body', () => {
  it('builds the body the server expects', () => {
    const body = toInput({
      ...emptyForm('items'), name: ' Starter deal ', value: '15', max_discount: '100', product_ids: ['p1'], category_ids: ['c1'],
      days: [4, 5, 6], start_time: '18:00', end_time: '22:00', starts_on: '2026-11-01', ends_on: '2026-11-30', code: 'deal15',
      order_types: ['DINE_IN'], channels: ['POS'], max_total: '100', max_per_customer: '1',
    });
    expect(body).toMatchObject({
      name: 'Starter deal', kind: 'items', benefit_type: 'percent', benefit_value: 15, max_discount: 100, product_ids: ['p1'], category_ids: ['c1'],
      days_of_week: [4, 5, 6], start_time: '18:00', end_time: '22:00', code: 'DEAL15', order_types: ['DINE_IN'], channels: ['POS'],
      max_uses_total: 100, max_uses_per_customer: 1, min_visits: null, free_product_id: null,
    });
    // the last day is inclusive: the offer stops at the start of the next day
    expect(body.starts_at!.startsWith('2026-11-01T00:00:00')).toBe(true);
    expect(body.ends_at!.startsWith('2026-12-01T00:00:00')).toBe(true);
  });
  it('round-trips a saved offer', () => {
    const saved: Offer = {
      id: 'o1', name: 'Regulars', description: null, code: null, kind: 'loyalty', benefit_type: 'free_item', benefit_value: 0, max_discount: null,
      free_product_id: 'chai', free_quantity: 2, min_order_amount: 500, product_ids: [], category_ids: [], min_visits: 5, visits_window_days: 90,
      channels: null, order_types: null, days_of_week: null, start_time: null, end_time: null, starts_at: null, ends_at: null, auto_apply: true,
      is_active: true, priority: 3, max_uses_total: null, max_uses_per_customer: 1, uses_count: 0, notify_email: true, summary: '', state: 'live', redemptions: 0,
    };
    expect(toInput(fromOffer(saved))).toMatchObject({
      kind: 'loyalty', benefit_type: 'free_item', free_product_id: 'chai', free_quantity: 2, min_order_amount: 500,
      min_visits: 5, visits_window_days: 90, priority: 3, max_uses_per_customer: 1, notify_email: true, days_of_week: null, starts_at: null,
    });
  });
});

describe('preview sentence', () => {
  it('reads like the offer', () => {
    const s = previewSentence({ ...emptyForm('loyalty'), name: 'Regulars', value: '20', min_order: '500', min_visits: '5', window_days: '90' }, names);
    expect(s).toContain('Regular customers get 20% off on bills above ₹500 after 5 visits in the last 90 days.');
    expect(s).toContain('Applied automatically');
    const t = previewSentence({
      ...emptyForm('items'), benefit_type: 'free_item', free_product_id: 'chai', product_ids: ['p1'], days: [5, 6], start_time: '22:00', end_time: '02:00', code: 'chai',
    }, names);
    expect(t).toContain('Customers get Masala Chai free when they buy Paneer Tikka');
    expect(t).toContain('on weekends');
    expect(t).toContain('22:00–02:00 (overnight)');
    expect(t).toContain('Code CHAI');
  });
});
