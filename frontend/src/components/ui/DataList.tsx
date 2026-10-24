/**
 * Virtualised list/table for big datasets (docs/20_High_Volume_UX.md §2, §5).
 * - Cards on narrow containers, a table with a sticky header row on wide ones.
 * - Fixed row heights → getItemLayout, so 10,000 rows scroll smoothly.
 * - Skeleton rows while loading, Empty/Error states, pull-to-refresh, "load more" paging.
 * - Optional checkbox selection, comfortable/compact density, keyboard navigation on web.
 *
 * For best performance memoise `columns`/`renderCard` (useMemo/useCallback) and keep `data` stable.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, FlatList, LayoutChangeEvent, ListRenderItemInfo, Platform, Pressable, StyleProp, StyleSheet, View, ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import { rowHeight as ROW_HEIGHTS } from '@/theme/tokens';
import { useHotkeys } from '@/hooks/useHotkeys';
import { Text } from './Text';
import { Button } from './Button';
import { EmptyState, ErrorState } from './Surface';
import { Checkbox, Skeleton } from './Checkbox';
import { fixedItemLayout, selectionState, toggleKey, visibleColumns } from './listLogic';

type IconName = keyof typeof Ionicons.glyphMap;

export interface DataColumn<T> {
  key: string;
  title: string;
  /** Fixed width in px. Without it the column flexes. */
  width?: number;
  flex?: number;
  minWidth?: number;
  align?: 'left' | 'right' | 'center';
  /** Right-aligned tabular numbers (money, counts). */
  numeric?: boolean;
  /** Hide this column when the table is narrower than this (px). */
  hideBelow?: number;
  sortable?: boolean;
  /** Plain text value (default: item[key]). */
  value?: (item: T) => string | number | null | undefined;
  /** Custom cell. Must fit the fixed row height (one line). */
  render?: (item: T, index: number) => React.ReactNode;
}

export type DataListDensity = 'comfortable' | 'compact';
export interface DataListSort { key: string; dir: 'asc' | 'desc' }

export interface DataListProps<T> {
  data: readonly T[] | null | undefined;
  keyExtractor: (item: T, index: number) => string;
  columns?: DataColumn<T>[];
  /** Card for narrow layouts; rendered inside a fixed-height box (`cardHeight`). Default: built from `columns`. */
  renderCard?: (item: T, info: { index: number; selected: boolean }) => React.ReactNode;
  /** auto = cards below `tableMinWidth` container width (or when no columns), table above. */
  layout?: 'auto' | 'table' | 'cards';
  tableMinWidth?: number;
  /** Default: compact on desktop web, comfortable on touch. */
  density?: DataListDensity;
  rowHeight?: number;
  cardHeight?: number;

  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  empty?: { icon?: IconName; title: string; message?: string; action?: { label: string; onPress: () => void; icon?: IconName } };
  skeletonRows?: number;

  refreshing?: boolean;
  onRefresh?: () => void;
  onEndReached?: () => void;
  loadingMore?: boolean;
  /** false stops onEndReached calls. */
  hasMore?: boolean;

  onPressRow?: (item: T, index: number) => void;
  /**
   * Right-click on a row (web), and long-press when the list isn't `selectable` (long-press selects otherwise):
   * open the row's ActionMenu through its `menuRef`.
   */
  onRowMenu?: (item: T, index: number) => void;
  selectable?: boolean;
  selectedKeys?: readonly string[];
  onSelectionChange?: (keys: string[]) => void;
  /** Trailing per-row actions (e.g. a "Ready" button + ActionMenu). Must fit the row height. */
  rowActions?: (item: T, index: number) => React.ReactNode;
  rowActionsWidth?: number;
  sort?: DataListSort | null;
  onSortChange?: (sort: DataListSort) => void;
  /** Rows to highlight as new (amber tint). */
  highlightKeys?: readonly string[];
  /** The row whose detail is open beside the list (side panel): tinted, without touching the checkbox selection. */
  openKey?: string | null;
  /** Arrow keys / Enter / Space on web (only when no input has focus). */
  keyboard?: boolean;

  /** Scrolls with the list, above the rows. */
  ListHeaderComponent?: React.ReactElement | null;
  /** Rendered below the list, outside the scroll area — the place for <SelectionBar/>. */
  selectionBar?: React.ReactNode;
  /** Re-render visible rows when this changes (same as FlatList extraData). */
  extraData?: unknown;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  testID?: string;
}

const CHECK_W = 48;
/** Rows contain buttons/checkboxes; on web a role=button row would nest <button>s, which is invalid HTML. */
const rowRole = (pressable: boolean) => (pressable && Platform.OS !== 'web' ? 'button' as const : undefined);
const CARD_GAP = 8;
const CARDS_PAD = 8;

function cellText<T>(col: DataColumn<T>, item: T): string {
  const v = col.value ? col.value(item) : (item as Record<string, unknown>)[col.key];
  return v === null || v === undefined ? '' : String(v);
}

function colStyle<T>(col: DataColumn<T>): ViewStyle {
  return col.width ? { width: col.width, flexShrink: 0 } : { flex: col.flex ?? 1, minWidth: col.minWidth ?? 60 };
}

function alignOf<T>(col: DataColumn<T>): 'flex-start' | 'flex-end' | 'center' {
  const a = col.align ?? (col.numeric ? 'right' : 'left');
  return a === 'right' ? 'flex-end' : a === 'center' ? 'center' : 'flex-start';
}

interface RowProps<T> {
  item: T;
  index: number;
  rowKey: string;
  mode: 'table' | 'cards';
  height: number;
  columns: DataColumn<T>[];
  selected: boolean;
  highlighted: boolean;
  open?: boolean;
  active: boolean;
  selectable: boolean;
  compact: boolean;
  onPress?: (item: T, index: number) => void;
  onMenu?: (item: T, index: number) => void;
  onToggle: (key: string) => void;
  renderCard?: DataListProps<T>['renderCard'];
  rowActions?: DataListProps<T>['rowActions'];
  rowActionsWidth: number;
  extraData?: unknown;
}

function RowImpl<T>({
  item, index, rowKey, mode, height, columns, selected, highlighted, open, active, selectable, compact, onPress, onMenu, onToggle, renderCard, rowActions, rowActionsWidth,
}: RowProps<T>) {
  const { colors, radius } = useTheme();
  const rowRef = useRef<View>(null);
  useEffect(() => {
    if (Platform.OS !== 'web' || !onMenu) return undefined;
    const node = rowRef.current as unknown as HTMLElement | null;
    if (!node?.addEventListener) return undefined;
    const handler = (e: MouseEvent) => { e.preventDefault(); onMenu(item, index); };
    node.addEventListener('contextmenu', handler);
    return () => node.removeEventListener('contextmenu', handler);
  }, [onMenu, item, index]);
  const bg = selected || open ? colors.selectedRow : highlighted ? colors.kitchenSoft : colors.surface;
  const check = selectable ? (
    <View style={styles.checkCell}>
      <Checkbox checked={selected} onChange={() => onToggle(rowKey)} accessibilityLabel={selected ? 'Deselect row' : 'Select row'} />
    </View>
  ) : null;
  const pressProps = {
    onPress: onPress ? () => onPress(item, index) : selectable ? () => onToggle(rowKey) : undefined,
    onLongPress: selectable ? () => onToggle(rowKey) : onMenu ? () => onMenu(item, index) : undefined,
    disabled: !onPress && !selectable && !onMenu,
  };

  if (mode === 'table') {
    return (
      <Pressable
        ref={rowRef}
        {...pressProps}
        accessibilityRole={rowRole(!!onPress)}
        accessibilityState={{ selected }}
        style={({ hovered }: any) => [
          styles.tableRow,
          { height, backgroundColor: hovered && !selected ? colors.surfaceAlt : bg, borderBottomColor: colors.divider },
          Platform.OS === 'web' && onPress ? ({ cursor: 'pointer' } as any) : null,
        ]}
      >
        {active ? <View style={[styles.activeBar, { backgroundColor: colors.primary }]} /> : null}
        {check}
        {columns.map((col) => (
          <View key={col.key} style={[styles.cell, colStyle(col), { alignItems: alignOf(col) }]}>
            {col.render ? col.render(item, index) : (
              <Text variant={compact ? 'small' : 'body'} numberOfLines={1} style={col.numeric ? styles.num : undefined}>{cellText(col, item)}</Text>
            )}
          </View>
        ))}
        {rowActions ? <View style={[styles.actionsCell, { width: rowActionsWidth }]}>{rowActions(item, index)}</View> : null}
      </Pressable>
    );
  }

  // Cards
  const [first, ...rest] = columns;
  const trailing = rest.length && (rest[rest.length - 1].numeric || rest[rest.length - 1].align === 'right') ? rest[rest.length - 1] : undefined;
  const middle = trailing ? rest.slice(0, -1) : rest;
  return (
    <View style={{ height: height + CARD_GAP, paddingBottom: CARD_GAP }}>
      <Pressable
        ref={rowRef}
        {...pressProps}
        accessibilityRole={rowRole(!!onPress)}
        accessibilityState={{ selected }}
        style={({ pressed }) => [
          styles.card,
          {
            height, backgroundColor: pressed ? colors.surfaceAlt : bg, borderRadius: radius.lg,
            borderColor: selected ? colors.primary : active ? colors.primary : colors.border,
          },
        ]}
      >
        {check}
        <View style={styles.cardBody}>
          {renderCard ? renderCard(item, { index, selected }) : first ? (
            <View style={styles.cardDefault}>
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                {first.render ? first.render(item, index) : <Text variant="bodyStrong" numberOfLines={1}>{cellText(first, item)}</Text>}
                {middle.length ? (
                  <Text variant="small" tone="muted" numberOfLines={1}>
                    {middle.map((c) => cellText(c, item)).filter(Boolean).join(' · ')}
                  </Text>
                ) : null}
              </View>
              {trailing ? (trailing.render ? trailing.render(item, index) : <Text variant="money" style={styles.num}>{cellText(trailing, item)}</Text>) : null}
            </View>
          ) : null}
        </View>
        {rowActions ? <View style={styles.cardActions}>{rowActions(item, index)}</View> : null}
      </Pressable>
    </View>
  );
}

const Row = React.memo(RowImpl) as typeof RowImpl;

export function DataList<T>({
  data, keyExtractor, columns = [], renderCard, layout = 'auto', tableMinWidth = 600, density, rowHeight, cardHeight,
  loading, error, onRetry, empty, skeletonRows = 8, refreshing, onRefresh, onEndReached, loadingMore, hasMore,
  onPressRow, onRowMenu, selectable, selectedKeys, onSelectionChange, rowActions, rowActionsWidth = 120, sort, onSortChange, highlightKeys, openKey, keyboard,
  ListHeaderComponent, selectionBar, extraData, style, contentContainerStyle, testID,
}: DataListProps<T>) {
  const { colors } = useTheme();
  const { width: windowWidth, isDesktop } = useLayout();
  const [width, setWidth] = useState(0);
  const [cursor, setCursor] = useState(-1);
  const [headerH, setHeaderH] = useState(0);
  const listRef = useRef<FlatList<T>>(null);

  const w = width || windowWidth;
  const mode: 'table' | 'cards' = layout === 'auto' ? (columns.length && w >= tableMinWidth ? 'table' : 'cards') : layout;
  const dens: DataListDensity = density ?? (Platform.OS === 'web' && isDesktop ? 'compact' : 'comfortable');
  const compact = dens === 'compact';
  const height = mode === 'table' ? rowHeight ?? ROW_HEIGHTS[dens] : cardHeight ?? (compact ? 64 : 76);
  const itemLength = mode === 'table' ? height : height + CARD_GAP;
  const cols = useMemo(
    () => visibleColumns(columns, w - (selectable ? CHECK_W : 0) - (rowActions ? rowActionsWidth : 0)),
    [columns, w, selectable, rowActions, rowActionsWidth],
  );

  const rows = data ?? [];
  const selectedSet = useMemo(() => new Set(selectedKeys ?? []), [selectedKeys]);
  const highlightSet = useMemo(() => new Set(highlightKeys ?? []), [highlightKeys]);
  const allKeys = useMemo(() => (selectable ? rows.map((it, i) => keyExtractor(it, i)) : []), [rows, selectable, keyExtractor]);
  const headState = selectable ? selectionState(allKeys, selectedSet) : 'none';

  const selRef = useRef(selectedKeys);
  selRef.current = selectedKeys;
  const onSelRef = useRef(onSelectionChange);
  onSelRef.current = onSelectionChange;
  const onToggle = useCallback((key: string) => onSelRef.current?.(toggleKey(selRef.current ?? [], key)), []);
  const toggleAll = () => onSelectionChange?.(headState === 'all' ? [] : allKeys);

  const getItemLayout = useMemo(() => fixedItemLayout(itemLength, 0, headerH + (mode === 'cards' ? CARDS_PAD : 0)), [itemLength, headerH, mode]);

  const endReached = useCallback(() => {
    if (!onEndReached || loading || loadingMore || hasMore === false || !rows.length) return;
    onEndReached();
  }, [onEndReached, loading, loadingMore, hasMore, rows.length]);

  // Keyboard navigation (web).
  useEffect(() => { if (cursor >= rows.length) setCursor(rows.length - 1); }, [rows.length, cursor]);
  const moveTo = (i: number) => {
    if (!rows.length) return;
    const next = Math.max(0, Math.min(rows.length - 1, i));
    setCursor(next);
    listRef.current?.scrollToIndex({ index: next, viewPosition: 0.5, animated: false });
  };
  useHotkeys({
    ArrowDown: () => moveTo(cursor + 1),
    ArrowUp: () => moveTo(cursor - 1),
    PageDown: () => moveTo(cursor + 10),
    PageUp: () => moveTo(cursor - 10),
    Enter: () => { if (cursor < 0 || !onPressRow) return false; onPressRow(rows[cursor], cursor); },
    Space: () => { if (cursor < 0 || !selectable) return false; onToggle(keyExtractor(rows[cursor], cursor)); },
  }, [], { enabled: !!keyboard && rows.length > 0 });

  const renderItem = useCallback(({ item, index }: ListRenderItemInfo<T>) => {
    const key = keyExtractor(item, index);
    return (
      <Row<T>
        item={item}
        index={index}
        rowKey={key}
        mode={mode}
        height={height}
        columns={cols}
        selected={selectedSet.has(key)}
        highlighted={highlightSet.has(key)}
        open={openKey != null && openKey === key}
        active={index === cursor}
        selectable={!!selectable}
        compact={compact}
        onPress={onPressRow}
        onMenu={onRowMenu}
        onToggle={onToggle}
        renderCard={renderCard}
        rowActions={rowActions}
        rowActionsWidth={rowActionsWidth}
        extraData={extraData}
      />
    );
  }, [keyExtractor, mode, height, cols, selectedSet, highlightSet, openKey, cursor, selectable, compact, onPressRow, onRowMenu, onToggle, renderCard, rowActions, rowActionsWidth, extraData]);

  const tableHeader = mode === 'table' && cols.length ? (
    <View style={[styles.headRow, { borderBottomColor: colors.border, backgroundColor: colors.surfaceAlt }]} accessibilityRole="header">
      {selectable ? (
        <View style={styles.checkCell}>
          <Checkbox checked={headState === 'all'} indeterminate={headState === 'some'} onChange={toggleAll}
            accessibilityLabel={headState === 'all' ? 'Deselect all' : 'Select all'} disabled={!rows.length} />
        </View>
      ) : null}
      {cols.map((col) => {
        const sorted = sort?.key === col.key ? sort.dir : null;
        const canSort = !!col.sortable && !!onSortChange;
        return (
          <Pressable
            key={col.key}
            disabled={!canSort}
            onPress={() => onSortChange?.({ key: col.key, dir: sorted === 'asc' ? 'desc' : 'asc' })}
            accessibilityRole={canSort ? 'button' : undefined}
            accessibilityLabel={canSort ? `Sort by ${col.title}` : col.title}
            style={[styles.cell, colStyle(col), styles.headCell, { justifyContent: alignOf(col) }, Platform.OS === 'web' && canSort ? ({ cursor: 'pointer' } as any) : null]}
          >
            <Text variant="caption" tone={sorted ? 'default' : 'muted'} numberOfLines={1} style={styles.headText}>{col.title}</Text>
            {sorted ? <Ionicons name={sorted === 'asc' ? 'arrow-up' : 'arrow-down'} size={12} color={colors.text} /> : null}
          </Pressable>
        );
      })}
      {rowActions ? <View style={{ width: rowActionsWidth }} /> : null}
    </View>
  ) : null;

  const footer = onEndReached ? (
    <View style={styles.footer}>
      {loadingMore ? <ActivityIndicator color={colors.primary} /> : null}
    </View>
  ) : null;

  const onLayout = (e: LayoutChangeEvent) => {
    const nw = Math.round(e.nativeEvent.layout.width);
    if (nw !== width) setWidth(nw);
  };

  let body: React.ReactNode;
  if (!rows.length && loading) {
    body = (
      <View accessibilityLabel="Loading" style={mode === 'cards' ? styles.cardsPad : undefined}>
        {Array.from({ length: skeletonRows }, (_, i) => (
          mode === 'table' ? (
            <View key={i} style={[styles.tableRow, { height, borderBottomColor: colors.divider, backgroundColor: colors.surface }]}>
              {selectable ? <View style={styles.checkCell}><Skeleton width={18} height={18} /></View> : null}
              {cols.map((c, ci) => (
                <View key={c.key} style={[styles.cell, colStyle(c), { alignItems: alignOf(c) }]}>
                  <Skeleton width={c.numeric ? 56 : ci === 0 ? '70%' : '50%'} height={12} />
                </View>
              ))}
              {rowActions ? <View style={{ width: rowActionsWidth }} /> : null}
            </View>
          ) : (
            <View key={i} style={{ height: height + CARD_GAP, paddingBottom: CARD_GAP }}>
              <View style={[styles.card, styles.skeletonCard, { height, borderColor: colors.border, backgroundColor: colors.surface }]}>
                <Skeleton width="55%" height={14} />
                <Skeleton width="35%" height={12} />
              </View>
            </View>
          )
        ))}
      </View>
    );
  } else if (!rows.length && error) {
    body = <View style={{ flex: 1 }}>{ListHeaderComponent ?? null}<ErrorState message={error} onRetry={onRetry} /></View>;
  } else if (!rows.length && !loading) {
    body = (
      <View style={{ flex: 1 }}>
        {ListHeaderComponent ?? null}
        <EmptyState icon={empty?.icon} title={empty?.title ?? 'Nothing here yet'} message={empty?.message} action={empty?.action} />
      </View>
    );
  } else {
    body = (
      <FlatList
        ref={listRef}
        data={rows}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        getItemLayout={getItemLayout}
        extraData={extraData}
        initialNumToRender={20}
        maxToRenderPerBatch={20}
        updateCellsBatchingPeriod={40}
        windowSize={9}
        removeClippedSubviews={Platform.OS === 'android'}
        onEndReached={endReached}
        onEndReachedThreshold={0.5}
        refreshing={onRefresh ? !!refreshing : undefined}
        onRefresh={onRefresh}
        ListHeaderComponent={ListHeaderComponent ? <View onLayout={(e) => setHeaderH(e.nativeEvent.layout.height)}>{ListHeaderComponent}</View> : null}
        ListFooterComponent={footer}
        contentContainerStyle={[mode === 'cards' ? styles.cardsPad : null, contentContainerStyle]}
        keyboardShouldPersistTaps="handled"
        onScrollToIndexFailed={() => {}}
        testID={testID}
      />
    );
  }

  return (
    <View style={[styles.root, style]} onLayout={onLayout}>
      {error && rows.length ? (
        <View style={[styles.inlineError, { backgroundColor: colors.dangerSoft }]}>
          <Ionicons name="cloud-offline-outline" size={16} color={colors.dangerText} />
          <Text variant="small" tone="danger" style={{ flex: 1 }} numberOfLines={1}>{error}</Text>
          {onRetry ? <Button title="Retry" size="sm" variant="ghost" onPress={onRetry} /> : null}
        </View>
      ) : null}
      {tableHeader}
      <View style={styles.body}>{body}</View>
      {selectionBar ? <View style={styles.selection}>{selectionBar}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0 },
  body: { flex: 1, minHeight: 0 },
  headRow: { flexDirection: 'row', alignItems: 'center', height: 36, borderBottomWidth: 1 },
  headCell: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  headText: { textTransform: 'uppercase' },
  tableRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth * 2 },
  activeBar: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3 },
  cell: { paddingHorizontal: 10, justifyContent: 'center', height: '100%', overflow: 'hidden' },
  num: { fontVariant: ['tabular-nums'], textAlign: 'right' },
  checkCell: { width: CHECK_W, alignItems: 'center', justifyContent: 'center', height: '100%' },
  actionsCell: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6, paddingRight: 8, height: '100%' },
  card: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, paddingHorizontal: 12, gap: 8, overflow: 'hidden' },
  cardBody: { flex: 1, minWidth: 0, justifyContent: 'center' },
  cardDefault: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardsPad: { paddingTop: CARDS_PAD },
  skeletonCard: { flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'center', gap: 8 },
  footer: { height: 56, alignItems: 'center', justifyContent: 'center' },
  inlineError: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, minHeight: 40 },
  selection: { paddingTop: 8 },
});
