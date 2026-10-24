/// <reference types="jest" />
import {
  CART_MAX, cartWidthFor, cashNotes, defaultPaymentMethod, gridMetrics, isLikelyCode, listMetrics, methodToRemember, moveHighlight, rowLayout,
  scrollToReveal,
} from '../posLayout';

describe('cart panel width', () => {
  it('takes about 38% of the billing area, within 340–440', () => {
    expect(cartWidthFor(744)).toBe(340); // 820 portrait tablet minus the icon rail: 38% would be a sliver
    expect(cartWidthFor(1096)).toBe(416); // 1180 landscape tablet
    expect(cartWidthFor(1672)).toBe(CART_MAX); // full HD desktop
    expect(cartWidthFor(1000)).toBe(380);
  });
  it('never squeezes the item grid below ~60% on tablets and desktops', () => {
    for (const w of [744, 1096, 1118, 1672]) expect(cartWidthFor(w) / w).toBeLessThanOrEqual(0.46);
  });
  it('copes with an unmeasured layout', () => {
    expect(cartWidthFor(0)).toBe(340);
  });
});

describe('item grid', () => {
  it('fits three tiles across a phone and more on wide panes', () => {
    expect(gridMetrics(390, true).columns).toBe(3);
    expect(gridMetrics(416, true).columns).toBe(3); // 820 portrait, next to the cart
    expect(gridMetrics(680, false).columns).toBe(4); // 1180 landscape
    expect(gridMetrics(1232, false).columns).toBe(7); // 1920 desktop
  });
  it('keeps tiles inside the pane and of a fixed height', () => {
    for (const [w, dense] of [[390, true], [680, false], [1232, false]] as const) {
      const g = gridMetrics(w, dense);
      expect(g.columns * g.tileWidth + (g.columns - 1) * g.gap + g.pad * 2).toBeLessThanOrEqual(w);
      expect(g.tileHeight).toBeLessThanOrEqual(86);
    }
  });
  it('never drops below two columns', () => {
    expect(gridMetrics(200, true).columns).toBe(2);
  });
});

describe('item list', () => {
  it('uses one column on phones and more on wide panes', () => {
    expect(listMetrics(390, false).columns).toBe(1);
    expect(listMetrics(700, true).columns).toBe(2);
    expect(listMetrics(1232, true).columns).toBe(3);
  });
  it('has touch-sized rows without a mouse and denser rows with one', () => {
    expect(listMetrics(390, false).rowHeight).toBeGreaterThanOrEqual(52);
    expect(listMetrics(900, true).rowHeight).toBeGreaterThanOrEqual(44);
  });
  it('lays out rows without measuring', () => {
    expect(rowLayout(86, 10, 3)).toEqual({ length: 96, offset: 288, index: 3 });
  });
});

describe('arrow keys', () => {
  const cols = 4;
  const count = 10; // rows: 0-3, 4-7, 8-9
  it('starts on the first item', () => {
    expect(moveHighlight(-1, 'down', cols, count)).toBe(0);
    expect(moveHighlight(-1, 'right', cols, count)).toBe(0);
  });
  it('moves within the grid and stops at the edges', () => {
    expect(moveHighlight(0, 'right', cols, count)).toBe(1);
    expect(moveHighlight(0, 'left', cols, count)).toBe(0);
    expect(moveHighlight(1, 'down', cols, count)).toBe(5);
    expect(moveHighlight(5, 'up', cols, count)).toBe(1);
    expect(moveHighlight(1, 'up', cols, count)).toBe(1);
    expect(moveHighlight(9, 'right', cols, count)).toBe(9);
  });
  it('drops to the last item of a short last row', () => {
    expect(moveHighlight(7, 'down', cols, count)).toBe(9);
    expect(moveHighlight(9, 'down', cols, count)).toBe(9);
  });
  it('works as a plain list', () => {
    expect(moveHighlight(2, 'down', 1, 5)).toBe(3);
    expect(moveHighlight(4, 'down', 1, 5)).toBe(4);
  });
  it('handles an empty list and a stale index', () => {
    expect(moveHighlight(0, 'down', cols, 0)).toBe(-1);
    expect(moveHighlight(42, 'down', cols, 3)).toBe(0);
  });
  it('scrolls only when the highlighted row is out of view', () => {
    expect(scrollToReveal(2, 100, 400, 0)).toBeNull();
    expect(scrollToReveal(5, 100, 400, 0)).toBe(208);
    expect(scrollToReveal(1, 100, 400, 300)).toBe(92);
  });
});

describe('barcode-like input', () => {
  it('recognises scanner codes and SKUs', () => {
    expect(isLikelyCode('8901234567890')).toBe(true);
    expect(isLikelyCode('SKU-0042')).toBe(true);
  });
  it('treats words as a name search', () => {
    expect(isLikelyCode('paneer')).toBe(false);
    expect(isLikelyCode('dal 2')).toBe(false);
    expect(isLikelyCode('42')).toBe(false);
  });
});

describe('payment defaults', () => {
  it('starts on the method used last, cash the first time', () => {
    expect(defaultPaymentMethod({ aggregator: false, last: null })).toBe('CASH');
    expect(defaultPaymentMethod({ aggregator: false, last: 'UPI' })).toBe('UPI');
  });
  it('never starts on credit, and aggregator bills are paid online', () => {
    expect(defaultPaymentMethod({ aggregator: false, last: 'CREDIT' })).toBe('CASH');
    expect(defaultPaymentMethod({ aggregator: true, last: 'UPI' })).toBe('AGGREGATOR');
  });
  it('remembers the method that took the most money', () => {
    expect(methodToRemember([{ method: 'CASH', amount: 100 }, { method: 'UPI', amount: 240 }])).toBe('UPI');
    expect(methodToRemember([{ method: 'CREDIT', amount: 500 }])).toBeNull();
    expect(methodToRemember([{ method: 'AGGREGATOR', amount: 500 }, { method: 'CARD', amount: 10 }])).toBe('CARD');
  });
});

describe('quick cash', () => {
  it('offers the exact amount, then the notes a customer hands over', () => {
    expect(cashNotes(340)).toEqual([340, 350, 400, 500, 2000]);
    expect(cashNotes(337)).toEqual([337, 340, 350, 400, 500]);
    expect(cashNotes(2000)).toEqual([2000]);
  });
  it('is empty when nothing is due', () => {
    expect(cashNotes(0)).toEqual([]);
  });
  it('never offers less than is due', () => {
    for (const due of [1, 99.5, 249, 1234.56]) for (const v of cashNotes(due)) expect(v).toBeGreaterThanOrEqual(due);
  });
});
