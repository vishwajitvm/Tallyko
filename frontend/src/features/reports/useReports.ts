import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { reportsApi } from '@/api/endpoints';
import { errorMessage } from '@/api/client';
import type { SalesSummary } from '@/api/types';
import { rangeQuery, type ReportRange } from './range';

export type ItemRow = Awaited<ReturnType<typeof reportsApi.items>>[number];
export type StaffRow = Awaited<ReturnType<typeof reportsApi.staff>>[number];
export type WastageRow = Awaited<ReturnType<typeof reportsApi.wastage>>[number];

interface Part<T> { data: T | null; error: string | null }

export interface ReportsState {
  summary: Part<SalesSummary>;
  items: Part<ItemRow[]>;
  staff: Part<StaffRow[]>;
  wastage: Part<WastageRow[]>;
  /** True while loading a range for the first time (show skeletons). */
  loading: boolean;
  refreshing: boolean;
  /** Key of the range the data belongs to. */
  key: string | null;
}

const empty = <T,>(): Part<T> => ({ data: null, error: null });

function settle<T>(r: PromiseSettledResult<T>): Part<T> {
  return r.status === 'fulfilled' ? { data: r.value, error: null } : { data: null, error: errorMessage(r.reason) };
}

/**
 * Loads the four report endpoints in parallel for a range. Requests for an older range that resolve late are ignored,
 * and each section keeps its own error so one failing report doesn't blank the page.
 */
export function useReports(range: ReportRange) {
  const { from, to } = rangeQuery(range);
  const key = `${from}|${to}`;
  const [state, setState] = useState<ReportsState>({
    summary: empty(), items: empty(), staff: empty(), wastage: empty(), loading: true, refreshing: false, key: null,
  });
  const latest = useRef(0);

  const load = useCallback(async (mode: 'initial' | 'refresh' | 'silent') => {
    const id = ++latest.current;
    setState((s) => ({ ...s, loading: mode === 'initial' ? true : s.loading, refreshing: mode === 'refresh' }));
    const [summary, items, staff, wastage] = await Promise.allSettled([
      reportsApi.summary(from, to), reportsApi.items(from, to), reportsApi.staff(from, to), reportsApi.wastage(from, to),
    ]);
    if (id !== latest.current) return;
    setState((s) => {
      // On a silent refresh keep the previous good data if a request fails
      const keep = <T,>(next: Part<T>, prev: Part<T>): Part<T> => (mode === 'silent' && next.error && prev.data ? prev : next);
      return {
        summary: keep(settle(summary), s.summary), items: keep(settle(items), s.items),
        staff: keep(settle(staff), s.staff), wastage: keep(settle(wastage), s.wastage),
        loading: false, refreshing: false, key,
      };
    });
  }, [from, to, key]);

  useEffect(() => { void load('initial'); }, [load]);

  // Refresh quietly when the user comes back to this tab (not on the first focus, which the effect above covers)
  const loadRef = useRef(load);
  loadRef.current = load;
  const focusedOnce = useRef(false);
  useFocusEffect(useCallback(() => {
    if (focusedOnce.current) void loadRef.current('silent');
    focusedOnce.current = true;
  }, []));

  return { ...state, reload: () => load('refresh'), retry: () => load('initial') };
}
