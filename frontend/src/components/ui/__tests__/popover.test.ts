import { computePopoverPosition, nextEnabledIndex } from '../popover';
import { fixedItemLayout, selectionState, toggleKey, visibleActionCount, visibleColumns } from '../listLogic';

const viewport = { width: 1366, height: 768 };
const menu = { width: 260, height: 200 };

describe('computePopoverPosition', () => {
  it('opens below, left-aligned, by default', () => {
    const p = computePopoverPosition({ anchor: { x: 100, y: 100, width: 80, height: 40 }, menu, viewport });
    expect(p).toMatchObject({ left: 100, top: 144, placement: 'bottom', align: 'start', maxHeight: 200, width: 260 });
  });

  it('flips up when there is no room below', () => {
    const p = computePopoverPosition({ anchor: { x: 100, y: 700, width: 80, height: 40 }, menu, viewport });
    expect(p.placement).toBe('top');
    expect(p.top).toBe(700 - 4 - 200);
  });

  it('flips to right-aligned near the right edge', () => {
    const p = computePopoverPosition({ anchor: { x: 1300, y: 100, width: 50, height: 40 }, menu, viewport });
    expect(p.align).toBe('end');
    expect(p.left).toBe(1350 - 260);
  });

  it('flips end to start when end alignment would overflow the left edge', () => {
    const p = computePopoverPosition({ anchor: { x: 10, y: 100, width: 40, height: 40 }, menu, viewport, align: 'end' });
    expect(p.align).toBe('start');
    expect(p.left).toBe(10);
  });

  it('never leaves the viewport and caps width on tiny screens', () => {
    const small = { width: 200, height: 300 };
    const p = computePopoverPosition({ anchor: { x: 150, y: 120, width: 40, height: 40 }, menu: { width: 260, height: 400 }, viewport: small });
    expect(p.width).toBe(184);
    expect(p.left).toBeGreaterThanOrEqual(8);
    expect(p.left + p.width).toBeLessThanOrEqual(192);
    expect(p.top).toBeGreaterThanOrEqual(8);
    expect(p.top + p.maxHeight).toBeLessThanOrEqual(292);
  });

  it('limits height to the space on the chosen side', () => {
    const p = computePopoverPosition({ anchor: { x: 0, y: 300, width: 40, height: 40 }, menu: { width: 200, height: 1000 }, viewport });
    expect(p.placement).toBe('bottom');
    expect(p.maxHeight).toBe(768 - 340 - 4 - 8);
  });
});

describe('nextEnabledIndex', () => {
  const disabled = [false, true, false, false];
  it('skips disabled items and wraps', () => {
    expect(nextEnabledIndex(disabled, -1, 1)).toBe(0);
    expect(nextEnabledIndex(disabled, 0, 1)).toBe(2);
    expect(nextEnabledIndex(disabled, 3, 1)).toBe(0);
    expect(nextEnabledIndex(disabled, 2, -1)).toBe(0);
    expect(nextEnabledIndex(disabled, -1, -1)).toBe(3);
  });
  it('returns -1 when everything is disabled', () => {
    expect(nextEnabledIndex([true, true], 0, 1)).toBe(-1);
    expect(nextEnabledIndex([], 0, 1)).toBe(-1);
  });
});

describe('list logic', () => {
  it('shows more selection actions on wider bars', () => {
    expect(visibleActionCount(360, 5)).toBe(1);
    expect(visibleActionCount(500, 5)).toBe(2);
    expect(visibleActionCount(800, 5)).toBe(3);
    expect(visibleActionCount(1200, 5)).toBe(4);
    expect(visibleActionCount(1200, 5, 2)).toBe(2);
    expect(visibleActionCount(1200, 2)).toBe(2);
    expect(visibleActionCount(1200, 0)).toBe(0);
  });

  it('computes fixed item layout offsets', () => {
    const layout = fixedItemLayout(44, 0, 10);
    expect(layout(null, 0)).toEqual({ length: 44, offset: 10, index: 0 });
    expect(layout(null, 9999)).toEqual({ length: 44, offset: 10 + 44 * 9999, index: 9999 });
  });

  it('derives header checkbox state', () => {
    expect(selectionState(['a', 'b'], new Set())).toBe('none');
    expect(selectionState(['a', 'b'], new Set(['a']))).toBe('some');
    expect(selectionState(['a', 'b'], new Set(['a', 'b', 'z']))).toBe('all');
  });

  it('toggles keys immutably', () => {
    const s = ['a'];
    expect(toggleKey(s, 'b')).toEqual(['a', 'b']);
    expect(toggleKey(s, 'a')).toEqual([]);
    expect(s).toEqual(['a']);
  });

  it('hides low-priority columns on narrow tables', () => {
    const cols = [{ key: 'name' }, { key: 'phone', hideBelow: 700 }, { key: 'total' }];
    expect(visibleColumns(cols, 650).map((c) => c.key)).toEqual(['name', 'total']);
    expect(visibleColumns(cols, 900).map((c) => c.key)).toEqual(['name', 'phone', 'total']);
  });
});
