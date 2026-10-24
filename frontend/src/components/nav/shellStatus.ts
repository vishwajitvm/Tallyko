/**
 * Quiet shell status shared by the sidebar footer, the phone "More" page and Settings:
 *  - the business's Tallyko access ("Development access", "Free demo · 5 days left") for owners and managers;
 *  - the owner's badge for answers from Tallyko to their requests (archive / delete bills), shown on Owner's watch.
 */
import { useEffect } from 'react';
import { create } from 'zustand';
import { ownerApi } from '@/api/owner';
import type { SubscriptionState } from '@/api/types';
import { daysText, liveDaysLeft } from '@/features/subscription/format';
import { useAuth } from '@/store/auth';
import { useSubscription } from '@/store/subscription';
import { useNavPrefs } from './navPrefs';

export interface AccessLine { status: SubscriptionState['state']; label: string }

/** One short line about the subscription, or null when there is nothing worth saying (staff never see it). */
export function accessLine(sub: SubscriptionState | null | undefined, now = Date.now()): AccessLine | null {
  if (!sub) return null;
  if (sub.state === 'development') return { status: 'development', label: 'Development access' };
  const left = liveDaysLeft(sub, now);
  if (sub.state === 'trial') return { status: 'trial', label: left === null ? 'Free demo' : `Free demo · ${daysText(left)}` };
  if (sub.state === 'grace') return { status: 'grace', label: 'Payment due' };
  if (sub.state === 'lapsed') return { status: 'lapsed', label: 'Subscription ended' };
  if (left !== null && left <= 14) return { status: 'active', label: `Plan · ${daysText(left)}` };
  return null;
}

export function useAccessLine(): AccessLine | null {
  const role = useAuth((s) => s.session?.role ?? null);
  const current = useSubscription((s) => s.current);
  if (role !== 'owner' && role !== 'manager') return null;
  return accessLine(current);
}

// --- Owner requests answered by Tallyko --------------------------------------------------------------------------

export const useOwnerAnswers = create<{ count: number }>(() => ({ count: 0 }));

const POLL_MS = 120_000;

/** Counts answers newer than the last visit to Owner's watch. Runs once in the shell (owners only). */
export function useOwnerAnswersPoll(activeRoute: string) {
  const isOwner = useAuth((s) => s.session?.accountType === 'business' && s.session?.role === 'owner');
  const tenantId = useAuth((s) => s.session?.tenantId);

  useEffect(() => {
    if (!isOwner) {
      useOwnerAnswers.setState({ count: 0 });
      return undefined;
    }
    let stopped = false;
    const check = async () => {
      try {
        const rows = await ownerApi.requests();
        if (stopped) return;
        const prefs = useNavPrefs.getState();
        if (!prefs.requestsSeenAt) {
          // First run on this device: start from now rather than flagging every old answer
          prefs.set({ requestsSeenAt: new Date().toISOString() });
          useOwnerAnswers.setState({ count: 0 });
          return;
        }
        const seen = new Date(prefs.requestsSeenAt).getTime();
        useOwnerAnswers.setState({ count: rows.filter((r) => r.status !== 'pending' && r.handled_at && new Date(r.handled_at).getTime() > seen).length });
      } catch {
        /* offline or no access: keep the last count */
      }
    };
    void check();
    const id = setInterval(() => void check(), POLL_MS);
    return () => { stopped = true; clearInterval(id); };
  }, [isOwner, tenantId]);

  useEffect(() => {
    if (activeRoute !== 'watch' || !isOwner) return;
    useNavPrefs.getState().set({ requestsSeenAt: new Date().toISOString() });
    useOwnerAnswers.setState({ count: 0 });
  }, [activeRoute, isOwner]);
}
