import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from '@/api/client';

export interface Page<T> {
  items: T[];
  /** Total rows for the filters (e.g. from `X-Total-Count`); without it a full page means "maybe more". */
  total?: number;
  /** Anything else the first page carries (filter-chip counts…). */
  meta?: unknown;
}

/**
 * Server search + paging for long lists (docs/20_High_Volume_UX.md §2):
 * - the first page loads whenever `key` changes (stale responses are ignored);
 * - `loadMore` appends the next page (rows already shown are not repeated);
 * - `reload` re-reads the first page with the pull-to-refresh spinner, `refreshSilently` without it.
 */
export function usePagedList<T>(
  fetchPage: (offset: number, limit: number) => Promise<Page<T>>,
  key: string,
  opts: { pageSize?: number; idOf?: (row: T) => string } = {},
) {
  const { pageSize = 50, idOf } = opts;
  const [items, setItems] = useState<T[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [meta, setMeta] = useState<unknown>(undefined);
  const [lastFull, setLastFull] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gen = useRef(0);
  const fetchRef = useRef(fetchPage);
  fetchRef.current = fetchPage;
  const itemsRef = useRef<T[]>([]);
  itemsRef.current = items;
  const busyMore = useRef(false);
  const idRef = useRef(idOf);
  idRef.current = idOf;

  const first = useCallback(async (mode: 'initial' | 'refresh' | 'silent') => {
    const my = mode === 'initial' ? ++gen.current : gen.current;
    if (mode === 'refresh') setRefreshing(true);
    try {
      const page = await fetchRef.current(0, pageSize);
      if (my !== gen.current) return;
      setItems(page.items);
      setTotal(page.total ?? null);
      setMeta(page.meta);
      setLastFull(page.items.length >= pageSize);
      setError(null);
    } catch (e) {
      if (my === gen.current) setError(errorMessage(e));
    } finally {
      if (my === gen.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [pageSize]);

  useEffect(() => {
    setLoading(true);
    setItems([]);
    setTotal(null);
    void first('initial');
  }, [key, first]);

  const hasMore = total !== null ? items.length < total : lastFull;

  const loadMore = useCallback(async () => {
    if (busyMore.current || !hasMore) return;
    busyMore.current = true;
    const my = gen.current;
    setLoadingMore(true);
    try {
      const page = await fetchRef.current(itemsRef.current.length, pageSize);
      if (my !== gen.current) return;
      const id = idRef.current;
      setItems((prev) => {
        if (!id) return [...prev, ...page.items];
        const seen = new Set(prev.map(id));
        return [...prev, ...page.items.filter((r) => !seen.has(id(r)))];
      });
      if (page.total !== undefined) setTotal(page.total);
      setLastFull(page.items.length >= pageSize);
    } catch (e) {
      if (my === gen.current) setError(errorMessage(e));
    } finally {
      busyMore.current = false;
      setLoadingMore(false);
    }
  }, [hasMore, pageSize]);

  return {
    items, setItems, total, meta, loading, loadingMore, refreshing, error, hasMore,
    loadMore: () => void loadMore(),
    reload: () => first('refresh'),
    refreshSilently: () => first('silent'),
  };
}
