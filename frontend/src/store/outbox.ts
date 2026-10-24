/**
 * Offline order queue. When the server can't be reached, completed bills are saved here with a
 * client-generated id and replayed through /sync/push later. The backend treats the id as an
 * idempotency key, so retries never create duplicate bills.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { persistStorage } from '@/lib/storage';
import { syncApi } from '@/api/endpoints';
import type { Order, OrderCreateInput } from '@/api/types';

export interface QueuedOrder {
  id: string;
  tenantId: string;
  payload: OrderCreateInput;
  /** Locally computed preview so the bill can be shown/printed before the server confirms it. */
  preview: { total: number; itemCount: number; label: string };
  createdAt: string;
  attempts: number;
  lastError: string | null;
  /** Permanently rejected by the server (e.g. item deleted) — needs a human to look at it. */
  failed: boolean;
}

interface OutboxState {
  queue: QueuedOrder[];
  pushing: boolean;
  enqueue: (item: Omit<QueuedOrder, 'attempts' | 'lastError' | 'failed'>) => void;
  discard: (id: string) => void;
  retry: (id: string) => void;
  push: (tenantId: string) => Promise<{ synced: Order[]; failed: number }>;
}

/**
 * Whether a per-bill rejection from /sync/push means the server will never take the bill as it is.
 * Sign-in (401), subscription (402), timeouts (408) and rate limits (429) are temporary: the bill is kept for a retry,
 * so nothing made offline is lost while a business renews.
 */
export function isPermanentRejection(code: number | null | undefined): boolean {
  const c = code ?? 500;
  if (c === 401 || c === 402 || c === 408 || c === 429) return false;
  return c >= 400 && c < 500;
}

export const useOutbox = create<OutboxState>()(
  persist(
    (set, get) => ({
      queue: [],
      pushing: false,
      enqueue: (item) => set((s) => ({ queue: [...s.queue.filter((q) => q.id !== item.id), { ...item, attempts: 0, lastError: null, failed: false }] })),
      discard: (id) => set((s) => ({ queue: s.queue.filter((q) => q.id !== id) })),
      retry: (id) => set((s) => ({ queue: s.queue.map((q) => (q.id === id ? { ...q, failed: false, lastError: null } : q)) })),
      push: async (tenantId) => {
        const pending = get().queue.filter((q) => q.tenantId === tenantId && !q.failed).slice(0, 50);
        if (get().pushing || pending.length === 0) return { synced: [], failed: 0 };
        set({ pushing: true });
        try {
          const { results } = await syncApi.push(pending.map((q) => q.payload));
          const byId = new Map(results.map((r) => [r.id, r]));
          const synced: Order[] = [];
          let failed = 0;
          set((s) => ({
            queue: s.queue.flatMap((q) => {
              const r = byId.get(q.id);
              if (!r) return [q];
              if (r.status === 'ok') {
                if (r.order) synced.push(r.order);
                return [];
              }
              // 4xx = the server will never accept it as-is; 5xx (and auth / subscription / rate limits) = try again later
              const permanent = isPermanentRejection(r.code);
              if (permanent) failed += 1;
              return [{ ...q, attempts: q.attempts + 1, lastError: r.error ?? 'Rejected by server', failed: permanent }];
            }),
          }));
          return { synced, failed };
        } finally {
          set({ pushing: false });
        }
      },
    }),
    { name: 'tallyko.outbox', storage: persistStorage, version: 1, partialize: (s) => ({ queue: s.queue }) },
  ),
);
