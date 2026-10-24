import { router } from 'expo-router';
import { confirm } from '@/components/ui';
import { sessionsApi } from '@/api/subscription';
import { useAuth } from '@/store/auth';
import { useOutbox } from '@/store/outbox';
import { useAccess } from '@/store/access';

/**
 * Sign this device out: revoke the session on the server (best effort — offline or an already-ended session must
 * never block signing out), then clear it locally. Offline bills stay in the outbox for the next sign-in.
 */
export async function endSession(): Promise<void> {
  const session = useAuth.getState().session;
  // /auth/logout is a business-login route; platform consoles only sign out locally
  if (session && session.accountType === 'business') {
    try {
      await sessionsApi.logout();
    } catch {
      /* offline / already signed out: the local sign-out below is what matters */
    }
  }
  await useAuth.getState().logout();
  useAccess.getState().reset();
}

/** Confirm, warn about bills that haven't synced yet, then sign out and return to the login screen. */
export async function signOut(): Promise<void> {
  const tenantId = useAuth.getState().session?.tenantId;
  const pending = useOutbox.getState().queue.filter((q) => !tenantId || q.tenantId === tenantId).length;
  const ok = await confirm({
    title: 'Sign out?',
    message: pending
      ? `${pending} offline bill${pending > 1 ? 's are' : ' is'} still waiting to sync. They stay saved on this device and will sync after someone signs in here again.`
      : 'You can sign back in any time.',
    confirmLabel: 'Sign out',
    danger: pending > 0,
  });
  if (!ok) return;
  await endSession();
  router.replace('/login');
}
