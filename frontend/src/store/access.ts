import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { accessApi } from '@/api/endpoints';
import type { AccessInfo } from '@/api/types';
import { persistStorage } from '@/lib/storage';
import { useAuth } from '@/store/auth';

/**
 * What the signed-in staff member may do: permissions from their role and features from the business's plan
 * (minus modules the owner hid). The server enforces all of it; the app uses it to hide screens and buttons.
 * Kept on the device so the right screens show while offline.
 */
interface AccessState {
  /** The login this info belongs to (never show one account's access to another) */
  userId: string | null;
  info: AccessInfo | null;
  refresh: () => Promise<void>;
  reset: () => void;
}

export const useAccess = create<AccessState>()(
  persist(
    (set) => ({
      userId: null,
      info: null,
      refresh: async () => {
        const session = useAuth.getState().session;
        if (!session || session.accountType !== 'business') return;
        try {
          const info = await accessApi.me();
          set({ info, userId: session.userId });
        } catch {
          /* offline — keep what we had */
        }
      },
      reset: () => set({ info: null, userId: null }),
    }),
    { name: 'tallyko.access', storage: persistStorage, version: 1 },
  ),
);

function currentInfo(): AccessInfo | null {
  const { info, userId } = useAccess.getState();
  return info && userId === (useAuth.getState().session?.userId ?? null) ? info : null;
}

/** Null until /access/me has loaded at least once for this login. */
export function useAccessInfo(): AccessInfo | null {
  const info = useAccess((s) => s.info);
  const owner = useAccess((s) => s.userId);
  const userId = useAuth((s) => s.session?.userId ?? null);
  return info && owner === userId ? info : null;
}

/** True when the user holds any of the permissions (and, if given, the business has the feature). */
export function hasAccess(info: AccessInfo | null, opts: { permissions?: string[]; feature?: string }): boolean | null {
  if (!info) return null; // unknown yet: callers fall back to the built-in role rules
  if (opts.feature && !info.features.includes(opts.feature)) return false;
  if (opts.permissions?.length && !opts.permissions.some((p) => info.permissions.includes(p))) return false;
  return true;
}

export function useCan(permission: string, feature?: string): boolean {
  const info = useAccessInfo();
  return hasAccess(info, { permissions: [permission], feature }) ?? false;
}

export function canNow(permission: string): boolean {
  return currentInfo()?.permissions.includes(permission) ?? false;
}
