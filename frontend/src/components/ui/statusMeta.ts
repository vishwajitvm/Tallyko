/** Pure status → label/icon/tone mapping (docs/20_High_Volume_UX.md §4). No React, so it is unit-tested. */
import type { Ionicons } from '@expo/vector-icons';

type IconName = keyof typeof Ionicons.glyphMap;

export type KitchenStatus = 'pending' | 'preparing' | 'ready' | 'served' | 'void';
export type OrderStatus = 'placed' | 'open' | 'completed' | 'cancelled' | 'merged';
export type PaymentStatus = 'unpaid' | 'partial' | 'paid' | 'claim';
export type SubscriptionStatus = 'trial' | 'development' | 'active' | 'grace' | 'lapsed';
export type KnownStatus = KitchenStatus | OrderStatus | PaymentStatus | SubscriptionStatus;
export type StatusTone = 'pending' | 'progress' | 'ready' | 'neutral' | 'void' | 'waiting' | 'brand' | 'danger';

export interface StatusMeta { label: string; icon: IconName; tone: StatusTone; struck?: boolean }

export const STATUS_META: Record<KnownStatus, StatusMeta> = {
  // Kitchen
  pending: { label: 'Pending', icon: 'time-outline', tone: 'pending' },
  preparing: { label: 'Preparing', icon: 'flame-outline', tone: 'progress' },
  ready: { label: 'Ready', icon: 'checkmark-circle', tone: 'ready' },
  served: { label: 'Served', icon: 'checkmark-done', tone: 'neutral' },
  void: { label: 'Void', icon: 'close-circle-outline', tone: 'void', struck: true },
  // Orders
  placed: { label: 'New', icon: 'receipt-outline', tone: 'pending' },
  open: { label: 'Running', icon: 'restaurant-outline', tone: 'progress' },
  completed: { label: 'Completed', icon: 'checkmark-done', tone: 'neutral' },
  cancelled: { label: 'Cancelled', icon: 'close-circle-outline', tone: 'void', struck: true },
  merged: { label: 'Merged', icon: 'git-merge-outline', tone: 'neutral' },
  // Payment
  unpaid: { label: 'Unpaid', icon: 'wallet-outline', tone: 'pending' },
  partial: { label: 'Part paid', icon: 'pie-chart-outline', tone: 'progress' },
  paid: { label: 'Paid', icon: 'checkmark-done', tone: 'neutral' },
  claim: { label: 'Claimed', icon: 'hourglass-outline', tone: 'waiting' },
  // Subscription
  trial: { label: 'Trial', icon: 'sparkles-outline', tone: 'brand' },
  development: { label: 'Development', icon: 'construct-outline', tone: 'progress' },
  active: { label: 'Active', icon: 'checkmark-circle', tone: 'ready' },
  grace: { label: 'Grace period', icon: 'alert-circle-outline', tone: 'pending' },
  lapsed: { label: 'Lapsed', icon: 'close-circle-outline', tone: 'danger' },
};

/** Aliases that the API or older screens use for the same states. */
const ALIASES: Record<string, KnownStatus> = {
  new: 'placed', queued: 'pending', in_progress: 'preparing', cooking: 'preparing', done: 'served', delivered: 'served',
  voided: 'void', canceled: 'cancelled', running: 'open', closed: 'completed', settled: 'paid', part_paid: 'partial',
  partially_paid: 'partial', pending_claim: 'claim', claimed: 'claim', awaiting: 'claim', expired: 'lapsed', past_due: 'grace',
  dev: 'development',
};

function titleCase(s: string) {
  return s.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}

/** Look up colour/icon/label for any status string; unknown values get a neutral pill with a readable label. */
export function statusMeta(status: string | null | undefined): StatusMeta {
  const key = String(status ?? '').trim().toLowerCase();
  const known = (STATUS_META as Record<string, StatusMeta>)[key] ?? (ALIASES[key] ? STATUS_META[ALIASES[key]] : undefined);
  return known ?? { label: key ? titleCase(key) : 'Unknown', icon: 'ellipse-outline', tone: 'neutral' };
}
