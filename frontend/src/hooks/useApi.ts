import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { errorMessage } from '@/api/client';

/**
 * Minimal data-fetching hook: loads on mount and whenever the screen regains focus,
 * exposes loading/refreshing/error and a reload(). Keeps the last good data on errors.
 */
export function useApi<T>(fetcher: () => Promise<T>, deps: unknown[] = [], opts: { refetchOnFocus?: boolean; intervalMs?: number } = {}) {
  const { refetchOnFocus = true, intervalMs } = opts;
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const mounted = useRef(true);
  const loadedOnce = useRef(false);

  const load = useCallback(async (mode: 'initial' | 'refresh' | 'silent' = 'silent') => {
    if (mode === 'refresh') setRefreshing(true);
    try {
      const result = await fetcherRef.current();
      if (!mounted.current) return;
      setData(result);
      setError(null);
      loadedOnce.current = true;
    } catch (e) {
      if (mounted.current) setError(errorMessage(e));
    } finally {
      if (mounted.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    setLoading(true);
    void load('initial');
    return () => { mounted.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useFocusEffect(
    useCallback(() => {
      if (refetchOnFocus && loadedOnce.current) void load('silent');
      if (!intervalMs) return undefined;
      const id = setInterval(() => void load('silent'), intervalMs);
      return () => clearInterval(id);
    }, [load, refetchOnFocus, intervalMs]),
  );

  return { data, setData, error, loading, refreshing, reload: () => load('refresh'), silentReload: () => load('silent') };
}
