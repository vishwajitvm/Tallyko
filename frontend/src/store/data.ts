/**
 * Offline cache of the business's working data. Screens read from here first so the
 * POS opens instantly and keeps working without internet; the sync engine refreshes it.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { persistStorage } from '@/lib/storage';
import { syncApi } from '@/api/endpoints';
import type { Brand, BusinessSettings, Category, Customer, Product, SalesChannel, TableInfo, TaxSnapshot } from '@/api/types';

function mergeById<T extends { id: string }>(current: T[], incoming: T[], full: boolean): T[] {
  if (full) return incoming;
  const map = new Map(current.map((x) => [x.id, x]));
  for (const item of incoming) map.set(item.id, item);
  return Array.from(map.values());
}

interface DataState {
  tenantId: string | null;
  settings: BusinessSettings | null;
  categories: Category[];
  products: Product[];
  tables: TableInfo[];
  channels: SalesChannel[];
  brands: Brand[];
  customers: Customer[];
  tax: TaxSnapshot | null;
  lastSyncedAt: string | null;
  syncing: boolean;
  syncError: string | null;
  pull: (tenantId: string, force?: boolean) => Promise<void>;
  upsertProduct: (p: Product) => void;
  removeProduct: (id: string) => void;
  upsertCustomer: (c: Customer) => void;
  setSettings: (s: BusinessSettings) => void;
  reset: () => void;
}

const empty = {
  tenantId: null, settings: null, categories: [], products: [], tables: [], channels: [], brands: [], customers: [], tax: null,
  lastSyncedAt: null, syncing: false, syncError: null,
};

export const useData = create<DataState>()(
  persist(
    (set, get) => ({
      ...empty,
      pull: async (tenantId, force = false) => {
        if (get().syncing) return;
        // Another business's cache must never leak into this session
        const sameTenant = get().tenantId === tenantId;
        const since = sameTenant && !force ? get().lastSyncedAt : null;
        set({ syncing: true, syncError: null });
        try {
          const r = await syncApi.pull(since);
          const s = get();
          const full = r.full || !sameTenant;
          set({
            tenantId,
            settings: r.settings,
            channels: r.channels,
            categories: mergeById(sameTenant ? s.categories : [], r.categories, full),
            products: mergeById(sameTenant ? s.products : [], r.products, full),
            tables: mergeById(sameTenant ? s.tables : [], r.tables, full),
            brands: mergeById(sameTenant ? s.brands : [], r.brands, full),
            customers: mergeById(sameTenant ? s.customers : [], r.customers, full),
            tax: r.tax ?? (sameTenant ? s.tax : null),
            lastSyncedAt: r.server_time,
            syncing: false,
          });
        } catch (e: any) {
          set({ syncing: false, syncError: e?.message ?? 'Sync failed' });
          throw e;
        }
      },
      upsertProduct: (p) => set((s) => ({ products: mergeById(s.products, [p], false) })),
      removeProduct: (id) => set((s) => ({ products: s.products.map((p) => (p.id === id ? { ...p, is_active: false } : p)) })),
      upsertCustomer: (c) => set((s) => ({ customers: mergeById(s.customers, [c], false) })),
      setSettings: (settings) => set({ settings }),
      reset: () => set({ ...empty }),
    }),
    {
      name: 'tallyko.data',
      storage: persistStorage,
      version: 1,
      partialize: (s) => ({
        tenantId: s.tenantId, settings: s.settings, categories: s.categories, products: s.products, tables: s.tables,
        channels: s.channels, brands: s.brands, customers: s.customers, tax: s.tax, lastSyncedAt: s.lastSyncedAt,
      }),
    },
  ),
);

export const activeProducts = (products: Product[]) => products.filter((p) => p.is_active);
export const activeCategories = (categories: Category[]) =>
  categories.filter((c) => c.is_active).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
