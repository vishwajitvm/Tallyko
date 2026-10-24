/**
 * Catalog data for the management screens: products (incl. deleted) + categories straight from the API,
 * seeded from the offline cache so the screen paints instantly. Every mutation is mirrored into the
 * shared `useData` cache so Billing sees the change without waiting for the next sync.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { catalogApi } from '@/api/endpoints';
import { errorMessage } from '@/api/client';
import type { Category, Product } from '@/api/types';
import { useAuth } from '@/store/auth';
import { useData } from '@/store/data';
import { syncNow } from '@/lib/sync';

function mergeById<T extends { id: string }>(list: T[], items: T[]): T[] {
  const map = new Map(list.map((x) => [x.id, x]));
  for (const item of items) map.set(item.id, item);
  return Array.from(map.values());
}

/** Mirrors category changes into the offline cache used by Billing. */
export function cacheCategories(items: Category[]) {
  useData.setState((s) => ({ categories: mergeById(s.categories, items) }));
}

export function cacheProducts(items: Product[]) {
  useData.setState((s) => ({ products: mergeById(s.products, items) }));
}

let syncTimer: ReturnType<typeof setTimeout> | null = null;
/** Debounced background sync after a burst of edits. */
export function scheduleSync() {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    void syncNow();
  }, 1500);
}

export function useCatalog() {
  const tenantId = useAuth((s) => s.session?.tenantId ?? null);
  const seed = () => {
    const d = useData.getState();
    return d.tenantId && d.tenantId === tenantId ? d : null;
  };
  const [products, setProducts] = useState<Product[] | null>(() => {
    const s = seed();
    return s && s.products.length ? s.products : null;
  });
  const [categories, setCategories] = useState<Category[]>(() => seed()?.categories ?? []);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const mounted = useRef(true);
  const loadedOnce = useRef(false);

  const load = useCallback(async (mode: 'initial' | 'refresh' | 'silent' = 'silent') => {
    if (mode === 'refresh') setRefreshing(true);
    try {
      const [p, c] = await Promise.all([catalogApi.products({ include_inactive: true }), catalogApi.categories()]);
      if (!mounted.current) return;
      setProducts(p);
      setCategories(c);
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
    void load('initial');
    return () => {
      mounted.current = false;
    };
  }, [load, tenantId]);

  useFocusEffect(
    useCallback(() => {
      if (loadedOnce.current) void load('silent');
    }, [load]),
  );

  const upsertProduct = useCallback((p: Product) => {
    setProducts((list) => mergeById(list ?? [], [p]));
    useData.getState().upsertProduct(p);
    scheduleSync();
  }, []);

  const upsertProducts = useCallback((items: Product[]) => {
    if (!items.length) return;
    setProducts((list) => mergeById(list ?? [], items));
    cacheProducts(items);
    scheduleSync();
  }, []);

  const removeProduct = useCallback((id: string) => {
    setProducts((list) => (list ?? []).map((p) => (p.id === id ? { ...p, is_active: false } : p)));
    useData.getState().removeProduct(id);
    scheduleSync();
  }, []);

  const upsertCategories = useCallback((items: Category[]) => {
    if (!items.length) return;
    setCategories((list) => mergeById(list, items));
    cacheCategories(items);
    scheduleSync();
  }, []);

  const dropCategory = useCallback((id: string) => {
    setCategories((list) => list.filter((c) => c.id !== id));
    useData.setState((s) => ({ categories: s.categories.map((c) => (c.id === id ? { ...c, is_active: false } : c)) }));
    scheduleSync();
  }, []);

  return {
    products,
    categories,
    error,
    loading: loading && products === null,
    refreshing,
    reload: () => load('refresh'),
    silentReload: () => load('silent'),
    upsertProduct,
    upsertProducts,
    removeProduct,
    upsertCategories,
    dropCategory,
  };
}

export type CatalogState = ReturnType<typeof useCatalog>;
