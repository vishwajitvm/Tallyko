/**
 * Background sync: pull fresh menu/tables/settings, push queued offline bills.
 * Runs on sign-in, every minute while the app is open, when connectivity returns, and when the app comes to the foreground.
 */
import NetInfo from '@react-native-community/netinfo';
import { AppState } from 'react-native';
import { create } from 'zustand';
import { useAuth } from '@/store/auth';
import { useData } from '@/store/data';
import { useOutbox } from '@/store/outbox';
import { useSubscription } from '@/store/subscription';

interface NetState {
  online: boolean;
  serverReachable: boolean;
  set: (patch: Partial<Omit<NetState, 'set'>>) => void;
}

export const useNet = create<NetState>()((set) => ({ online: true, serverReachable: true, set: (patch) => set(patch) }));

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

/**
 * Push offline bills, then pull fresh data.
 * While the subscription is locked (HTTP 402) pushing is paused: the queued bills stay untouched on the device
 * (never marked failed, never dropped) and go up on the first sync after renewal.
 */
export async function syncNow(force = false): Promise<void> {
  const tenantId = useAuth.getState().session?.tenantId;
  if (!tenantId || running) return;
  if (useSubscription.getState().locked) return;
  running = true;
  try {
    await useOutbox.getState().push(tenantId);
    await useData.getState().pull(tenantId, force);
    useNet.getState().set({ serverReachable: true });
  } catch (e: any) {
    if (e?.network) useNet.getState().set({ serverReachable: false });
    // 402: the API client has already locked the app; the outbox keeps every bill for after renewal.
    // 401: the session ended; the outbox is kept per business and syncs after the next sign-in.
  } finally {
    running = false;
  }
}

export function startSync(): () => void {
  void syncNow();
  if (timer) clearInterval(timer);
  timer = setInterval(() => void syncNow(), 60_000);

  const unsubscribeNet = NetInfo.addEventListener((state) => {
    const online = state.isConnected !== false && state.isInternetReachable !== false;
    const wasOffline = !useNet.getState().online;
    useNet.getState().set({ online });
    if (online && wasOffline) void syncNow();
  });
  const appStateSub = AppState.addEventListener('change', (s) => {
    if (s === 'active') void syncNow();
  });

  return () => {
    if (timer) clearInterval(timer);
    timer = null;
    unsubscribeNet();
    appStateSub.remove();
  };
}
