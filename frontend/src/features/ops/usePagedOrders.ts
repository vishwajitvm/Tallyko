import { useCallback, useEffect, useRef, useState } from 'react';
import { opsApi, summaryFromOrder, type OrderListQuery, type OrderStatusCounts, type OrderSummaryRow } from '@/api/floor';
import { errorMessage } from '@/api/client';
import type { Order } from '@/api/types';
import { mergeFirstPage, pruneMarks } from './floorLogic';
import { usePageVisible, useScreenFocused } from '@/hooks/live';

export type OrderQuery = Omit<OrderListQuery, 'limit' | 'offset'>;

const FRESH_MS = 20_000;

/**
 * Server-paged order list for tens of thousands of bills (light `summary` rows, no lines or payments):
 * - the first page loads on every filter change (older responses are ignored) together with the per-status counts
 *   for the same filters (`with_counts`), so the chips cost no extra requests;
 * - "load more" appends the next page;
 * - a silent refresh (every `refreshMs` while visible, and on coming back) re-reads only the first page and merges it,
 *   so rows the user scrolled to are kept and new bills slide in at the top (marked in `fresh` for a few seconds).
 */
export function usePagedOrders(query: OrderQuery, pageSize = 50, refreshMs = 20_000) {
  const [items, setItems] = useState<OrderSummaryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<OrderStatusCounts>({});
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<Record<string, number>>({});
  const key = JSON.stringify(query);
  const gen = useRef(0);
  const itemsRef = useRef<OrderSummaryRow[]>([]);
  itemsRef.current = items;
  const queryRef = useRef(query);
  queryRef.current = query;
  const busyMore = useRef(false);
  const visible = usePageVisible();
  const focused = useScreenFocused();

  const fetchPage = useCallback(async (mode: 'initial' | 'refresh' | 'silent' | 'more') => {
    const myGen = mode === 'initial' ? ++gen.current : gen.current;
    if (mode === 'more') {
      if (busyMore.current) return;
      busyMore.current = true;
      setLoadingMore(true);
    }
    if (mode === 'refresh') setRefreshing(true);
    try {
      const offset = mode === 'more' ? itemsRef.current.length : 0;
      const res = await opsApi.orderSummaries({ ...queryRef.current, limit: pageSize, offset }, mode !== 'more');
      if (myGen !== gen.current) return;
      setTotal(res.total);
      if (res.counts) setCounts(res.counts);
      if (mode === 'more') {
        setItems((prev) => {
          const known = new Set(prev.map((o) => o.id));
          return [...prev, ...res.items.filter((o) => !known.has(o.id))];
        });
      } else if (mode === 'initial') {
        setItems(res.items);
        setFresh({});
      } else {
        const before = new Set(itemsRef.current.map((o) => o.id));
        const added = itemsRef.current.length ? res.items.filter((o) => !before.has(o.id)).map((o) => o.id) : [];
        setItems((prev) => mergeFirstPage(prev, res.items));
        if (added.length) {
          const at = Date.now();
          setFresh((f) => ({ ...pruneMarks(f, at, FRESH_MS), ...Object.fromEntries(added.map((id) => [id, at])) }));
        }
      }
      setError(null);
    } catch (e) {
      if (myGen === gen.current) setError(errorMessage(e));
    } finally {
      if (mode === 'more') busyMore.current = false;
      if (myGen === gen.current) {
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
      }
    }
  }, [pageSize]);

  useEffect(() => {
    setLoading(true);
    setItems([]);
    setCounts({});
    void fetchPage('initial');
  }, [key, fetchPage]);

  const live = visible && focused;
  const wasLive = useRef(live);
  useEffect(() => {
    if (!live) { wasLive.current = false; return undefined; }
    if (!wasLive.current) void fetchPage('silent');
    wasLive.current = true;
    const id = setInterval(() => void fetchPage('silent'), refreshMs);
    return () => clearInterval(id);
  }, [live, refreshMs, fetchPage]);

  /** Fold a changed bill (from the detail panel) into its row; the next silent refresh corrects the counts. */
  const replace = useCallback((order: Order) => {
    setItems((prev) => prev.map((o) => (o.id === order.id ? summaryFromOrder(o, order) : o)));
  }, []);

  const freshKeys = Object.keys(pruneMarks(fresh, Date.now(), FRESH_MS));

  return {
    items, total, counts, loading, loadingMore, refreshing, error, fresh: freshKeys,
    hasMore: items.length < total,
    reload: () => fetchPage('refresh'),
    /** Re-read the first page and the counts without a spinner. */
    refreshSilently: () => fetchPage('silent'),
    loadMore: () => { if (items.length < total) void fetchPage('more'); },
    replace,
  };
}
