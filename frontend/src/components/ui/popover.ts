/** Pure geometry for anchored popovers (ActionMenu). Kept free of React so it is unit-tested. */

export interface Rect { x: number; y: number; width: number; height: number }
export interface Size { width: number; height: number }

export interface PopoverPlacementInput {
  anchor: Rect;
  menu: Size;
  viewport: Size;
  /** Preferred side: below (default) or above the anchor. */
  placement?: 'bottom' | 'top';
  /** Preferred horizontal edge: menu's left edge on anchor's left (start, default) or right edges aligned (end). */
  align?: 'start' | 'end';
  /** Distance kept from the viewport edges. */
  margin?: number;
  /** Gap between the anchor and the menu. */
  gap?: number;
}

export interface PopoverPosition {
  left: number;
  top: number;
  width: number;
  /** Height the menu may use before it must scroll. */
  maxHeight: number;
  placement: 'bottom' | 'top';
  align: 'start' | 'end';
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

/**
 * Place a menu next to its trigger, inside the viewport: below and left-aligned by default,
 * flipping up when there is not enough room below (and more room above), and flipping to
 * right-aligned when it would overflow the right edge. Never returns a position off-screen.
 */
export function computePopoverPosition({
  anchor, menu, viewport, placement = 'bottom', align = 'start', margin = 8, gap = 4,
}: PopoverPlacementInput): PopoverPosition {
  const width = Math.max(0, Math.min(menu.width, viewport.width - margin * 2));

  // Vertical
  const spaceBelow = viewport.height - (anchor.y + anchor.height) - gap - margin;
  const spaceAbove = anchor.y - gap - margin;
  let side: 'bottom' | 'top' = placement;
  if (side === 'bottom' && menu.height > spaceBelow && spaceAbove > spaceBelow) side = 'top';
  else if (side === 'top' && menu.height > spaceAbove && spaceBelow > spaceAbove) side = 'bottom';
  const room = Math.max(0, side === 'bottom' ? spaceBelow : spaceAbove);
  const maxHeight = Math.max(Math.min(menu.height, room), Math.min(menu.height, 120));
  let top = side === 'bottom' ? anchor.y + anchor.height + gap : anchor.y - gap - maxHeight;
  top = clamp(top, margin, Math.max(margin, viewport.height - margin - maxHeight));

  // Horizontal
  const startLeft = anchor.x;
  const endLeft = anchor.x + anchor.width - width;
  const fitsStart = startLeft + width <= viewport.width - margin && startLeft >= margin;
  const fitsEnd = endLeft >= margin && endLeft + width <= viewport.width - margin;
  let edge: 'start' | 'end' = align;
  if (align === 'start' && !fitsStart && fitsEnd) edge = 'end';
  else if (align === 'end' && !fitsEnd && fitsStart) edge = 'start';
  let left = edge === 'start' ? startLeft : endLeft;
  left = clamp(left, margin, Math.max(margin, viewport.width - margin - width));

  return { left, top, width, maxHeight, placement: side, align: edge };
}

/** Next enabled index when moving with arrow keys (wraps around); -1 when nothing is enabled. */
export function nextEnabledIndex(disabled: boolean[], from: number, step: 1 | -1): number {
  const n = disabled.length;
  if (!n) return -1;
  if (from < 0 || from >= n) from = step === 1 ? -1 : n;
  for (let i = 1; i <= n; i++) {
    const idx = (((from + step * i) % n) + n) % n;
    if (!disabled[idx]) return idx;
  }
  return -1;
}
