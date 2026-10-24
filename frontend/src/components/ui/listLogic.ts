/** Pure helpers for SelectionBar and DataList (unit-tested, no React). */

/** How many SelectionBar actions get their own button at this bar width; the rest go into "More". */
export function visibleActionCount(width: number, total: number, maxVisible = 4, minVisible = 1): number {
  if (total <= 0) return 0;
  const byWidth = width < 420 ? 1 : width < 640 ? 2 : width < 900 ? 3 : 4;
  const cap = Math.max(1, minVisible, Math.min(byWidth, maxVisible));
  return Math.min(total, Math.min(cap, Math.max(maxVisible, minVisible)));
}

/** Fixed-height getItemLayout for FlatList: offset = index × (height + gap). */
export function fixedItemLayout(itemHeight: number, gap = 0, headerHeight = 0) {
  return (_: unknown, index: number) => ({ length: itemHeight, offset: headerHeight + (itemHeight + gap) * index, index });
}

/** Header checkbox state for a selection against the currently loaded rows. */
export function selectionState(keys: string[], selected: ReadonlySet<string>): 'none' | 'some' | 'all' {
  if (!keys.length || !selected.size) return 'none';
  let hit = 0;
  for (const k of keys) if (selected.has(k)) hit++;
  return hit === 0 ? 'none' : hit === keys.length ? 'all' : 'some';
}

/** Toggle one key in a selection, returning a new array (order of first selection kept). */
export function toggleKey(selected: readonly string[], key: string): string[] {
  return selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key];
}

export interface ColumnSizing { key: string; width?: number; flex?: number; minWidth?: number; hideBelow?: number }

/** Columns visible at this table width: drop columns whose `hideBelow` is larger than the width. */
export function visibleColumns<C extends ColumnSizing>(columns: C[], width: number): C[] {
  return columns.filter((c) => !c.hideBelow || width >= c.hideBelow);
}
