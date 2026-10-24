import { create } from 'zustand';
import { kitchenApi, ordersApi } from '@/api/endpoints';
import { useAuth } from '@/store/auth';

interface BadgeState {
  online: number; // new online / QR / aggregator orders waiting to be accepted
  kitchen: number; // active kitchen tickets
  refresh: () => Promise<void>;
}

export const useBadges = create<BadgeState>()((set) => ({
  online: 0,
  kitchen: 0,
  refresh: async () => {
    const role = useAuth.getState().session?.role;
    if (!role) return;
    try {
      const [placed, tickets] = await Promise.all([
        role === 'kitchen' ? Promise.resolve({ total: 0 }) : ordersApi.list({ status: 'placed', limit: 1 }),
        kitchenApi.tickets('active'),
      ]);
      set({ online: placed.total, kitchen: tickets.filter((t) => t.status === 'pending').length });
    } catch {
      /* offline — keep last counts */
    }
  },
}));
