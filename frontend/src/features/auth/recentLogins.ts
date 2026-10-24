/**
 * People who signed in on this device recently (email + display name only, never passwords), so staff at shift change
 * pick their name instead of typing their email. Stored per device; "Forget" removes one.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { persistStorage } from '@/lib/storage';

export interface RecentLogin { email: string; name: string | null; business: string | null; at: number }

const MAX = 6;

interface RecentState {
  recent: RecentLogin[];
  remember: (entry: Omit<RecentLogin, 'at'>) => void;
  forget: (email: string) => void;
}

export function addRecent(list: RecentLogin[], entry: Omit<RecentLogin, 'at'>, now = Date.now()): RecentLogin[] {
  const email = entry.email.trim();
  if (!email) return list;
  const rest = list.filter((r) => r.email.toLowerCase() !== email.toLowerCase());
  return [{ ...entry, email, at: now }, ...rest].slice(0, MAX);
}

export const useRecentLogins = create<RecentState>()(
  persist(
    (set) => ({
      recent: [],
      remember: (entry) => set((s) => ({ recent: addRecent(s.recent, entry) })),
      forget: (email) => set((s) => ({ recent: s.recent.filter((r) => r.email.toLowerCase() !== email.toLowerCase()) })),
    }),
    { name: 'tallyko.recentLogins', storage: persistStorage, version: 1, partialize: (s) => ({ recent: s.recent }) as RecentState },
  ),
);
