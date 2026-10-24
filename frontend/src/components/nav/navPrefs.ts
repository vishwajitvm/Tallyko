/**
 * Per-device shell preferences: the collapsed desktop sidebar, subscription notices hidden for the day and when the owner
 * last looked at Tallyko's answers to their requests. Kept apart from `usePrefs` so the shell owns its own small state.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { persistStorage } from '@/lib/storage';

interface NavPrefsState {
  /** Desktop only: the full sidebar shrinks to an icon rail */
  sidebarCollapsed: boolean;
  /** Subscription notice key → local day (YYYY-MM-DD) it was hidden on */
  hiddenNotices: Record<string, string>;
  /** Owner's watch: answers to owner requests handled after this time show as a badge */
  requestsSeenAt: string | null;
  set: (patch: Partial<Omit<NavPrefsState, 'set'>>) => void;
}

export const useNavPrefs = create<NavPrefsState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      hiddenNotices: {},
      requestsSeenAt: null,
      set: (patch) => set(patch),
    }),
    { name: 'tallyko.nav', storage: persistStorage, version: 1 },
  ),
);

/** Local calendar day, e.g. 2026-10-24 (notices hidden "for today" come back tomorrow). */
export function localDay(now = new Date()): string {
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${m}-${d}`;
}

export function hideNoticeToday(key: string) {
  const today = localDay();
  const kept = Object.fromEntries(Object.entries(useNavPrefs.getState().hiddenNotices).filter(([, day]) => day === today));
  useNavPrefs.getState().set({ hiddenNotices: { ...kept, [key]: today } });
}

export function isNoticeHidden(hidden: Record<string, string>, key: string, now = new Date()): boolean {
  return hidden[key] === localDay(now);
}
