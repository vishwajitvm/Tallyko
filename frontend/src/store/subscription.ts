/**
 * The business's Tallyko subscription as this device knows it.
 *
 * - Login / refresh responses carry a snapshot (`apply`), kept in the saved session by the auth store.
 * - Any business API answering 402 locks the app at once (`markLocked`); the (app) layout then shows the renewal page.
 * - `refresh()` asks GET /subscription (allowed while locked), so the app unlocks by itself once Tallyko approves a payment.
 *
 * Locking never touches the offline outbox: bills made offline stay on the device and sync after renewal.
 */
import { create } from 'zustand';
import type { SubscriptionState } from '@/api/types';
import { subscriptionApi, type SubscriptionInfo } from '@/api/subscription';

interface SubscriptionStore {
  /** Business the state belongs to (a different login never inherits another business's lock) */
  tenantId: string | null;
  current: SubscriptionState | null;
  locked: boolean;
  /** Server message from the last 402 */
  lockMessage: string | null;
  /** Full GET /subscription answer (plans, offers, payment details, claims, history) */
  info: SubscriptionInfo | null;
  checkedAt: number | null;
  apply: (tenantId: string | null, sub: SubscriptionState | null | undefined) => void;
  markLocked: (message?: string | null) => void;
  /** GET /subscription; throws on failure (callers decide whether to show it). */
  refresh: () => Promise<SubscriptionInfo>;
  reset: () => void;
}

const EMPTY = { tenantId: null, current: null, locked: false, lockMessage: null, info: null, checkedAt: null };

let inflight: Promise<SubscriptionInfo> | null = null;

export function pickState(info: SubscriptionInfo | SubscriptionState): SubscriptionState {
  return {
    state: info.state, kind: info.kind ?? null, label: info.label ?? null, paid_until: info.paid_until ?? null,
    lock_at: info.lock_at, days_left: info.days_left ?? null, locked: !!info.locked,
  };
}

export const useSubscription = create<SubscriptionStore>()((set, get) => ({
  ...EMPTY,

  apply: (tenantId, sub) => {
    if (!tenantId) {
      set({ ...EMPTY });
      return;
    }
    const same = get().tenantId === tenantId;
    set({
      tenantId,
      current: sub ? pickState(sub) : same ? get().current : null,
      locked: sub ? !!sub.locked : same ? get().locked : false,
      lockMessage: sub && !sub.locked ? null : same ? get().lockMessage : null,
      info: same ? get().info : null,
    });
  },

  markLocked: (message) => {
    const cur = get().current;
    set({
      locked: true,
      lockMessage: message ?? get().lockMessage,
      current: cur
        ? { ...cur, state: 'lapsed', locked: true, days_left: 0 }
        : { state: 'lapsed', paid_until: null, days_left: 0, locked: true },
    });
  },

  refresh: () => {
    if (inflight) return inflight;
    const tenantAtStart = get().tenantId;
    inflight = subscriptionApi
      .get()
      .then((info) => {
        // A sign-out / different login while the request was out: drop the answer
        if (get().tenantId !== tenantAtStart) return info;
        set({
          info,
          current: pickState(info),
          locked: !!info.locked,
          lockMessage: info.locked ? get().lockMessage : null,
          checkedAt: Date.now(),
        });
        return info;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  },

  reset: () => set({ ...EMPTY }),
}));

/** Whether the app must show the renewal page instead of business screens. */
export function useLocked(): boolean {
  return useSubscription((s) => s.locked);
}
