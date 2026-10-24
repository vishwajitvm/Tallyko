import type { ChannelMenu } from '@/api/channels';
import type { Product, SalesChannel } from '@/api/types';
import {
  bulkMarkup, channelBadges, channelDraftErrors, channelDraftFrom, channelMenuCsv, channelMenuText, channelPricesPayload, channelQuote,
  cleanChannelPrices, markupPlaceholder, markupPrice, menuChannels, samePrices, setDraftEntry, withChannelPrice,
} from '../channelPricing';
import { itemGst } from '../utils';

const ch = (code: SalesChannel['code'], name: string, pct = 0, enabled = true): SalesChannel => ({
  id: code, code, name, enabled, commission_pct: 0, price_adjust_pct: pct, external_store_id: null, auto_accept: false,
});
const SWIGGY = ch('SWIGGY', 'Swiggy');
const ZOMATO = ch('ZOMATO', 'Zomato', 8);
const ONLINE = ch('ONLINE', 'Own online store');

const product = (over: Partial<Product> = {}): Product => ({
  id: 'p1', name: 'Chicken Dum Biryani', description: null, base_price: 249, cost_price: null, tax_rate: null, category_id: null,
  brand_id: null, barcode: null, sku: null, unit: 'pcs', is_veg: false, is_active: true, print_to_kitchen: true, track_stock: false,
  low_stock_threshold: null, sort_order: 0, variants: [], tax_class_id: null, channel_prices: {}, ...over,
});

describe('menu channels', () => {
  it('keeps enabled channels with their own menu, in a stable order', () => {
    const list = [ch('POS', 'Counter'), ch('OTHER', 'Phone'), ONLINE, ZOMATO, ch('MAGICPIN', 'magicpin', 0, false), SWIGGY];
    expect(menuChannels(list).map((c) => c.code)).toEqual(['SWIGGY', 'ZOMATO', 'ONLINE']);
    expect(menuChannels([ch('POS', 'Counter')])).toEqual([]);
  });
});

describe('mark-up preview', () => {
  it('rounds like the server', () => {
    expect(markupPrice(249, 8)).toBe(269);
    expect(markupPrice(199, 0)).toBe(199);
    expect(markupPrice(100, -5)).toBe(95);
  });
  it('explains the empty price field', () => {
    expect(markupPlaceholder(249, ZOMATO)).toBe('₹269 with Zomato\'s +8%');
    expect(markupPlaceholder(250, ZOMATO)).toBe('₹270 with Zomato\'s +8%');
    expect(markupPlaceholder(249, SWIGGY)).toBe('Same as counter (₹249)');
    expect(markupPlaceholder(null, ZOMATO)).toBe('Counter price +8%');
  });
  it('quotes own price, mark-up and options like the server', () => {
    const p = product({ variants: [{ id: 'h', name: 'Half', price: 249 }, { id: 'f', name: 'Full', price: 399 }], channel_prices: { SWIGGY: { price: 289 } } });
    const sw = channelQuote(p, SWIGGY);
    expect(sw).toMatchObject({ price: 289, source: 'item', available: true });
    expect(sw.variants.map((v) => v.price)).toEqual([289, 439]);
    const zo = channelQuote(p, ZOMATO);
    expect(zo.source).toBe('markup');
    expect(zo.variants.map((v) => v.price)).toEqual([269, 431]);
    expect(channelQuote(p, ONLINE).source).toBe('counter');
  });
  it('bulk +X% rounds to whole rupees when asked', () => {
    expect(bulkMarkup(249, 10, true)).toBe(274);
    expect(bulkMarkup(249, 10, false)).toBe(273.9);
    expect(bulkMarkup(45, 0, true)).toBe(45);
  });
});

describe('override cleanup', () => {
  it('drops empty entries, keeps price and hidden flags, upper-cases codes', () => {
    expect(cleanChannelPrices({ swiggy: { price: 289.555 }, ZOMATO: { available: true }, ONDC: { available: false }, ONLINE: {} }))
      .toEqual({ SWIGGY: { price: 289.56 }, ONDC: { available: false } });
    expect(cleanChannelPrices(null)).toEqual({});
  });
  it('sets and clears one channel price without touching availability or other channels', () => {
    const start = { SWIGGY: { price: 289 }, ZOMATO: { available: false } };
    expect(withChannelPrice(start, 'ZOMATO', 300)).toEqual({ SWIGGY: { price: 289 }, ZOMATO: { price: 300, available: false } });
    expect(withChannelPrice(start, 'SWIGGY', null)).toEqual({ ZOMATO: { available: false } });
    expect(withChannelPrice({ SWIGGY: { price: 1 } }, 'SWIGGY', null)).toEqual({});
  });
  it('compares prices ignoring empty entries', () => {
    expect(samePrices({ SWIGGY: { price: 289 } }, { SWIGGY: { price: 289, available: true }, ZOMATO: {} })).toBe(true);
    expect(samePrices({ SWIGGY: { price: 289 } }, {})).toBe(false);
    expect(samePrices(undefined, {})).toBe(true);
  });
});

describe('editor draft', () => {
  it('round-trips and keeps entries for channels the editor does not show', () => {
    const draft = channelDraftFrom({ SWIGGY: { price: 289 }, MAGICPIN: { available: false } });
    expect(draft).toEqual({ SWIGGY: { price: '289', available: true }, MAGICPIN: { price: '', available: false } });
    expect(channelPricesPayload(draft)).toEqual({ SWIGGY: { price: 289 }, MAGICPIN: { available: false } });
  });
  it('drops entries that go back to the default so the form is not dirty', () => {
    let d = setDraftEntry({}, 'zomato', { price: '300' });
    expect(d).toEqual({ ZOMATO: { price: '300', available: true } });
    d = setDraftEntry(d, 'ZOMATO', { price: '' });
    expect(d).toEqual({});
    d = setDraftEntry(d, 'ZOMATO', { available: false });
    expect(channelPricesPayload(d)).toEqual({ ZOMATO: { available: false } });
  });
  it('flags prices that are too high', () => {
    expect(channelDraftErrors({ SWIGGY: { price: '2000000', available: true }, ZOMATO: { price: '2000000', available: false } }))
      .toEqual({ SWIGGY: 'Price is too high.' });
  });
});

describe('menu row badges', () => {
  const apps = [SWIGGY, ZOMATO, ch('ONDC', 'ONDC'), ONLINE];
  const labels = (p: Product) => channelBadges(p, apps).map((b) => b.label);
  it('shows own prices', () => {
    expect(labels(product({ channel_prices: { SWIGGY: { price: 399 }, ZOMATO: { price: 389 } } }))).toEqual(['Swiggy ₹399', 'Zomato ₹389']);
  });
  it('shows what is hidden, or "X only"', () => {
    expect(labels(product({ channel_prices: { SWIGGY: { available: false }, ZOMATO: { price: 949 } } }))).toEqual(['Not on Swiggy', 'Zomato ₹949']);
    expect(labels(product({ channel_prices: { ZOMATO: { available: false }, ONDC: { available: false }, ONLINE: { available: false } } })))
      .toEqual(['Swiggy only']);
    expect(labels(product({ channel_prices: { POS: { available: false } } }))).toEqual(['Not at counter']);
    expect(labels(product())).toEqual([]);
  });
});

describe('channel menu export', () => {
  const menu: ChannelMenu = {
    channel: ZOMATO, available_count: 1, hidden_count: 1,
    items: [
      { id: '2', name: '=Peri Peri Fries', category: 'Wraps', is_veg: true, counter_price: 99, price: 106.92, price_source: 'markup', available: false, variants: [] },
      { id: '1', name: 'Mutton Biryani, Large', category: 'Biryani', is_veg: false, counter_price: 349, price: 389, price_source: 'item', available: true,
        variants: [{ name: 'Half', price: 389 }] },
    ],
  };
  it('builds a safe CSV with items on the menu first', () => {
    const lines = channelMenuCsv(menu).replace('﻿', '').trim().split('\r\n');
    expect(lines[0]).toBe('Item,Category,Veg,Counter price,Zomato price,Price source,On Zomato,Options');
    expect(lines[1]).toBe('"Mutton Biryani, Large",Biryani,Non-veg,349,389,Own price,Yes,Half 389');
    expect(lines[2]).toBe("'=Peri Peri Fries,Wraps,Veg,99,106.92,Mark-up,No,");
  });
  it('builds paste-able text', () => {
    const text = channelMenuText(menu);
    expect(text.split('\n')[0]).toBe('Zomato menu (1 item)');
    expect(text).toContain('Mutton Biryani, Large\t₹389.00');
    expect(text).toContain('Not on Zomato: =Peri Peri Fries');
  });
});

describe('row GST', () => {
  const tax = {
    registration: 'regular' as const, default_tax_class_id: 'std',
    classes: [
      { id: 'std', name: 'Restaurant 5%', is_active: true, rates: [{ effective_from: '2020-01-01T00:00:00Z', total_rate: 5 }] },
      { id: 'bev', name: 'Aerated 40%', is_active: true, rates: [{ effective_from: '2020-01-01T00:00:00Z', total_rate: 40 }] },
    ],
  };
  it('uses the item tax class, then legacy rate, then the default class', () => {
    expect(itemGst({ tax_class_id: 'bev', tax_rate: null }, tax, { default_tax_rate: 5 })).toEqual({ label: '40%', inherited: false });
    expect(itemGst({ tax_class_id: null, tax_rate: 12 }, tax, { default_tax_rate: 5 })).toEqual({ label: '12%', inherited: false });
    expect(itemGst({ tax_class_id: null, tax_rate: null }, tax, { default_tax_rate: 18 })).toEqual({ label: '5%', inherited: true });
    expect(itemGst({ tax_class_id: null, tax_rate: null }, { ...tax, registration: 'composition' }, null).label).toBe('No GST');
  });
});
