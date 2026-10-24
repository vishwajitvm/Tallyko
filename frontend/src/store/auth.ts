import { create } from 'zustand';
import { authApi } from '@/api/endpoints';
import { configureAuth } from '@/api/client';
import type { AccountType, AuthResponse, BusinessType, PlatformRole, Role, SubscriptionState } from '@/api/types';
import { secureStore } from '@/lib/storage';
import { useSubscription } from '@/store/subscription';

const SESSION_KEY = 'tallyko.session';

export interface Session {
  accessToken: string;
  refreshToken: string;
  /** Business logins run the POS; platform logins (super admin / support) only see the admin console */
  accountType: AccountType;
  platformRole: PlatformRole | null;
  /** Empty for platform logins */
  tenantId: string;
  role: Role;
  userId: string | null;
  email: string | null;
  fullName: string | null;
  businessName: string | null;
  /** The business's Tallyko subscription as last reported by the server (login, refresh, GET /subscription) */
  subscription?: SubscriptionState | null;
}

/** Why the device was signed out without the user asking; the login screen shows it once. */
export interface SignOutReason {
  title: string;
  message: string;
}

interface AuthState {
  status: 'loading' | 'signedOut' | 'signedIn';
  session: Session | null;
  signOutReason: SignOutReason | null;
  hydrate: () => Promise<void>;
  login: (email: string, password: string, baseUrl?: string) => Promise<void>;
  register: (body: { vendor_name: string; owner_name?: string; email: string; phone: string; password: string; business_type: BusinessType }, baseUrl?: string) => Promise<void>;
  /** Local sign-out. Offline bills (outbox) are kept on the device; they sync after the next sign-in to the same business. */
  logout: (reason?: SignOutReason | null) => Promise<void>;
  refresh: () => Promise<boolean>;
  clearSignOutReason: () => void;
}

function toSession(r: AuthResponse): Session {
  return {
    accessToken: r.access_token,
    refreshToken: r.refresh_token,
    accountType: r.account_type ?? 'business',
    platformRole: r.platform_role ?? null,
    tenantId: r.tenant_id ?? '',
    role: (r.role ?? 'owner') as Role,
    userId: r.user?.id ?? null,
    email: r.user?.email ?? null,
    fullName: r.user?.full_name ?? null,
    businessName: r.business_name,
    subscription: r.subscription ?? null,
  };
}

/** Push the session's subscription snapshot into the subscription store (business logins only). */
function applySubscription(session: Session | null) {
  if (!session || session.accountType !== 'business' || !session.tenantId) useSubscription.getState().reset();
  else useSubscription.getState().apply(session.tenantId, session.subscription ?? null);
}

const SIGNED_OUT_BY_SERVER = /signed out/i;

/** What to tell the user after the server refused this session (401 after a refresh attempt). */
function reasonFor(message: string | undefined, status?: number): SignOutReason {
  const lapsed = !!useSubscription.getState().current?.locked;
  if (message && SIGNED_OUT_BY_SERVER.test(message)) {
    return {
      title: 'You were signed out by Tallyko',
      message: lapsed
        ? 'Your subscription has ended. Sign in again to renew. Bills saved offline on this device are kept and sync after renewal.'
        : 'This device was signed out by Tallyko, from another device or after a password change. Sign in again. Bills saved offline on this device are kept.',
    };
  }
  if (status && status !== 401 && message) return { title: 'You were signed out', message };
  return { title: 'Your session ended', message: 'Please sign in again. Bills saved offline on this device are kept.' };
}

export const useAuth = create<AuthState>()((set, get) => ({
  status: 'loading',
  session: null,
  signOutReason: null,

  hydrate: async () => {
    const raw = await secureStore.get(SESSION_KEY);
    if (raw) {
      try {
        const stored = JSON.parse(raw) as Session;
        // Sessions saved before platform logins existed are business sessions
        const session: Session = { ...stored, accountType: stored.accountType ?? 'business', platformRole: stored.platformRole ?? null };
        set({ session, status: 'signedIn' });
        applySubscription(session);
        return;
      } catch {
        await secureStore.remove(SESSION_KEY);
      }
    }
    set({ status: 'signedOut' });
  },

  login: async (email, password, baseUrl) => {
    const session = toSession(await authApi.login(email, password, baseUrl));
    await secureStore.set(SESSION_KEY, JSON.stringify(session));
    set({ session, status: 'signedIn', signOutReason: null });
    applySubscription(session);
  },

  register: async (body, baseUrl) => {
    const session = toSession(await authApi.register(body, baseUrl));
    await secureStore.set(SESSION_KEY, JSON.stringify(session));
    set({ session, status: 'signedIn', signOutReason: null });
    applySubscription(session);
  },

  logout: async (reason = null) => {
    await secureStore.remove(SESSION_KEY);
    useSubscription.getState().reset();
    set({ session: null, status: 'signedOut', signOutReason: reason });
  },

  clearSignOutReason: () => set({ signOutReason: null }),

  refresh: async () => {
    const current = get().session;
    if (!current) return false;
    try {
      const session = toSession(await authApi.refresh(current.refreshToken));
      await secureStore.set(SESSION_KEY, JSON.stringify(session));
      set({ session });
      applySubscription(session);
      return true;
    } catch (e: any) {
      // Offline: keep the session so billing keeps working; only a real rejection signs out
      if (e?.network) return false;
      if (!get().session) return false; // already signed out meanwhile: keep the reason already shown
      await get().logout(reasonFor(e?.message, e?.status));
      return false;
    }
  },
}));

configureAuth({
  getAccessToken: () => useAuth.getState().session?.accessToken ?? null,
  refresh: () => useAuth.getState().refresh(),
  onUnauthorized: (message) => {
    if (!useAuth.getState().session) return; // already signed out (e.g. by the failed refresh)
    void useAuth.getState().logout(reasonFor(message, 401));
  },
  onPaymentRequired: (message) => {
    if (useAuth.getState().session?.accountType !== 'business') return;
    useSubscription.getState().markLocked(message);
  },
});

// Keep the saved session's subscription snapshot current, so a restart (even offline) knows whether the business is locked
useSubscription.subscribe((s, prev) => {
  if (s.current === prev.current || !s.current) return;
  const session = useAuth.getState().session;
  if (!session || session.accountType !== 'business' || s.tenantId !== session.tenantId) return;
  if (JSON.stringify(session.subscription ?? null) === JSON.stringify(s.current)) return;
  const next: Session = { ...session, subscription: s.current };
  useAuth.setState({ session: next });
  void secureStore.set(SESSION_KEY, JSON.stringify(next));
});

export function useIsPlatform(): boolean {
  return useAuth((s) => s.session?.accountType === 'platform');
}

export function useRole(): Role | null {
  return useAuth((s) => s.session?.role ?? null);
}

export function can(role: Role | null, action: 'manage' | 'bill' | 'order' | 'kitchen'): boolean {
  if (!role) return false;
  switch (action) {
    case 'manage': return role === 'owner' || role === 'manager';
    case 'bill': return role === 'owner' || role === 'manager' || role === 'cashier';
    case 'order': return role !== 'kitchen';
    case 'kitchen': return true;
  }
}
