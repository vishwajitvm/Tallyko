/**
 * Billing-screen preferences remembered per device: grid or list items, whether the tax breakdown is open,
 * and the payment method used last (the payment sheet starts on it).
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { persistStorage } from '@/lib/storage';
import type { PaymentMethod } from '@/api/types';
import type { ProductView } from './posLayout';

interface PosPrefsState {
  view: ProductView;
  totalsOpen: boolean;
  lastMethod: PaymentMethod | null;
  set: (patch: Partial<Omit<PosPrefsState, 'set'>>) => void;
}

export const usePosPrefs = create<PosPrefsState>()(
  persist(
    (set) => ({
      view: 'grid',
      totalsOpen: false,
      lastMethod: null,
      set: (patch) => set(patch),
    }),
    {
      name: 'tallyko.pos.prefs',
      storage: persistStorage,
      version: 1,
      partialize: (s) => ({ view: s.view, totalsOpen: s.totalsOpen, lastMethod: s.lastMethod }),
    },
  ),
);
