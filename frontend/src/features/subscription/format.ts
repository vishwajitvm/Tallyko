/** Wording and small calculations shared by the renewal page, the app-shell banner and Settings → Plan & billing. */
import type { BadgeTone } from '@/components/ui';
import type { SubscriptionState } from '@/api/types';
import type { PaymentMethod, PaymentRequest, SubscriptionPeriod } from '@/api/subscription';
import { formatDate } from '@/lib/format';

const DAY = 86_400_000;

/** Whole days until `iso` (rounded up, never negative); null when there is no date. */
export function daysUntil(iso: string | null | undefined, now = Date.now()): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - now;
  if (!Number.isFinite(ms)) return null;
  return ms > 0 ? Math.ceil(ms / DAY) : 0;
}

/** Days left, recomputed from the end date so an old snapshot doesn't show a stale count. */
export function liveDaysLeft(sub: SubscriptionState | null | undefined, now = Date.now()): number | null {
  if (!sub || sub.state === 'development') return null;
  return daysUntil(sub.paid_until, now) ?? sub.days_left ?? null;
}

export function daysText(n: number): string {
  if (n <= 0) return 'ends today';
  return n === 1 ? '1 day left' : `${n} days left`;
}

export const STATE_LABEL: Record<SubscriptionState['state'], string> = {
  trial: 'Free demo',
  development: 'Development access',
  active: 'Active',
  grace: 'Payment due',
  lapsed: 'Ended',
};

export const STATE_TONE: Record<SubscriptionState['state'], BadgeTone> = {
  trial: 'info',
  development: 'neutral',
  active: 'success',
  grace: 'warning',
  lapsed: 'danger',
};

export const KIND_LABEL: Record<string, string> = {
  trial: 'Free demo',
  paid: 'Paid',
  complimentary: 'Complimentary',
  development: 'Development access',
};

export const METHOD_LABEL: Record<PaymentMethod, string> = {
  upi: 'UPI',
  bank_transfer: 'Bank transfer',
  cash: 'Cash',
  card: 'Card',
  cheque: 'Cheque',
  other: 'Other',
};

export const REQUEST_STATUS: Record<PaymentRequest['status'], { label: string; tone: BadgeTone }> = {
  pending: { label: 'Waiting for confirmation', tone: 'warning' },
  approved: { label: 'Approved', tone: 'success' },
  rejected: { label: 'Not approved', tone: 'danger' },
};

/** "Your free demo ended on 21 Oct 2026" / "Subscription ended" — headline of the renewal page. */
export function lockHeadline(sub: SubscriptionState | null | undefined): { title: string; subtitle: string } {
  const ended = sub?.paid_until ? formatDate(sub.paid_until) : null;
  if (sub?.kind === 'trial') {
    return {
      title: ended ? `Your free demo ended on ${ended}` : 'Your free demo has ended',
      subtitle: 'Choose a plan to keep billing with Tallyko. Everything you set up during the demo is still here.',
    };
  }
  return {
    title: 'Subscription ended',
    subtitle: ended
      ? `Your Tallyko subscription ended on ${ended}. Renew to switch billing, orders and reports back on.`
      : 'Renew your Tallyko subscription to switch billing, orders and reports back on.',
  };
}

/** Banner line for owners/managers, or null when nothing needs saying. */
export function bannerFor(sub: SubscriptionState | null | undefined, now = Date.now()):
  { tone: 'info' | 'warning' | 'danger'; title: string; detail: string; urgent: boolean } | null {
  if (!sub || sub.locked || sub.state === 'lapsed' || sub.state === 'development') return null;
  const left = liveDaysLeft(sub, now);
  if (sub.state === 'grace') {
    const stops = sub.lock_at ? formatDate(sub.lock_at) : null;
    return { tone: 'danger', title: 'Payment due', detail: stops ? `access stops on ${stops}` : 'renew to keep using Tallyko', urgent: true };
  }
  if (sub.state === 'trial') {
    return { tone: left !== null && left <= 3 ? 'warning' : 'info', title: 'Free demo', detail: left === null ? 'renew any time' : daysText(left), urgent: left !== null && left <= 3 };
  }
  if (left !== null && left <= 7) {
    return { tone: left <= 3 ? 'warning' : 'info', title: 'Subscription ending', detail: `${daysText(left)} · renew by ${formatDate(sub.paid_until)}`, urgent: left <= 3 };
  }
  return null;
}

/** The period that is running now (or the latest one), from GET /subscription history. */
export function currentPeriod(history: SubscriptionPeriod[], now = Date.now()): SubscriptionPeriod | null {
  return history.find((h) => new Date(h.start_date).getTime() <= now && now < new Date(h.end_date).getTime()) ?? history[0] ?? null;
}

export function monthsText(months: number | null | undefined): string {
  if (!months) return '';
  if (months % 12 === 0) return months === 12 ? '1 year' : `${months / 12} years`;
  return months === 1 ? '1 month' : `${months} months`;
}

/** upi://pay link that opens any UPI app with the amount filled in. */
export function upiLink(opts: { upiId: string; payee: string; amount: number | null; note?: string }): string {
  const parts = [`pa=${encodeURIComponent(opts.upiId)}`, `pn=${encodeURIComponent(opts.payee || 'Tallyko')}`];
  if (opts.amount && opts.amount > 0) parts.push(`am=${opts.amount.toFixed(2)}`);
  parts.push('cu=INR');
  if (opts.note) parts.push(`tn=${encodeURIComponent(opts.note.slice(0, 60))}`);
  return `upi://pay?${parts.join('&')}`;
}

/** Readable names for plan feature keys (unknown keys are shown title-cased). */
const FEATURE_LABEL: Record<string, string> = {
  customers: 'Customers & CRM', inventory: 'Inventory', loyalty: 'Loyalty points', menu_ocr: 'Menu from a photo', offers: 'Offers & rewards',
  reports: 'Reports', advanced_reports: 'Advanced reports', email: 'Customer emails', kitchen: 'Kitchen display', online_store: 'Online store',
  qr_ordering: 'QR table ordering', staff: 'Staff logins', tables: 'Table management', audit_log: 'Activity log', brands: 'Cloud-kitchen brands',
  custom_roles: 'Custom roles', integrations: 'Swiggy/Zomato integration', online_orders: 'Online orders',
};

export function featureLabel(key: string): string {
  return FEATURE_LABEL[key] ?? key.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

export function limitsText(limits: Record<string, number | null> | null | undefined): string {
  if (!limits) return '';
  const parts: string[] = [];
  const staff = limits.max_staff;
  const items = limits.max_products;
  const outlets = limits.max_locations;
  parts.push(staff == null ? 'Unlimited staff' : `${staff} staff login${staff === 1 ? '' : 's'}`);
  parts.push(items == null ? 'unlimited items' : `${items.toLocaleString('en-IN')} items`);
  if (outlets != null && outlets > 1) parts.push(`${outlets} outlets`);
  return parts.join(' · ');
}
