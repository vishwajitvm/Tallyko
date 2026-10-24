import type { Ionicons } from '@expo/vector-icons';
import type { AccessInfo, BusinessType, Role } from '@/api/types';
import { hasAccess } from '@/store/access';

export interface NavItem {
  route: string; // tab route name
  href: string;
  label: string;
  /** Short label for the phone bottom bar */
  short?: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconActive: keyof typeof Ionicons.glyphMap;
  roles: Role[];
  /** Shown in the phone bottom bar (others live under "More") */
  primary?: boolean;
  hideFor?: BusinessType[];
  /** Once /access/me has loaded: shown when the user holds any of these permissions… */
  permissions?: string[];
  /** …and the business's plan includes this module (owners can also hide modules) */
  feature?: string;
  group: 'sell' | 'manage' | 'business';
  /** Only the business owner, never a permission that can be given to others (Owner's watch) */
  ownerOnly?: boolean;
  /** Desktop keyboard shortcut: "g" then this key */
  goKey?: string;
}

const ALL: Role[] = ['owner', 'manager', 'cashier', 'waiter', 'kitchen'];
const STAFF: Role[] = ['owner', 'manager', 'cashier', 'waiter'];
const MANAGERS: Role[] = ['owner', 'manager'];

export const NAV_ITEMS: NavItem[] = [
  { route: 'pos', href: '/pos', label: 'Billing', icon: 'receipt-outline', iconActive: 'receipt', roles: STAFF, primary: true, group: 'sell',
    permissions: ['orders.create'], goKey: 'b' },
  { route: 'orders', href: '/orders', label: 'Orders', icon: 'document-text-outline', iconActive: 'document-text', roles: STAFF, primary: true, group: 'sell',
    permissions: ['orders.create', 'orders.view_all', 'orders.pay'], goKey: 'o' },
  { route: 'tables', href: '/tables', label: 'Tables', icon: 'grid-outline', iconActive: 'grid', roles: STAFF, primary: true, hideFor: ['retail'], group: 'sell',
    permissions: ['tables.view'], feature: 'tables', goKey: 't' },
  { route: 'online', href: '/online', label: 'Online orders', short: 'Online', icon: 'bicycle-outline', iconActive: 'bicycle', roles: STAFF, group: 'sell',
    permissions: ['orders.accept_online'], goKey: 'n' },
  { route: 'kitchen', href: '/kitchen', label: 'Kitchen', icon: 'flame-outline', iconActive: 'flame', roles: ALL, primary: true, hideFor: ['retail'], group: 'sell',
    permissions: ['kitchen.view'], feature: 'kitchen', goKey: 'k' },
  { route: 'menu', href: '/menu', label: 'Menu & items', short: 'Menu', icon: 'fast-food-outline', iconActive: 'fast-food', roles: MANAGERS, group: 'manage',
    permissions: ['menu.manage'], goKey: 'm' },
  { route: 'inventory', href: '/inventory', label: 'Inventory', short: 'Stock', icon: 'cube-outline', iconActive: 'cube', roles: MANAGERS, group: 'manage',
    permissions: ['inventory.view', 'inventory.manage'], feature: 'inventory', goKey: 'i' },
  { route: 'customers', href: '/customers', label: 'Customers', icon: 'people-outline', iconActive: 'people', roles: STAFF, group: 'manage',
    permissions: ['customers.view'], feature: 'customers', goKey: 'c' },
  { route: 'offers', href: '/offers', label: 'Offers & rewards', short: 'Offers', icon: 'gift-outline', iconActive: 'gift', roles: MANAGERS, group: 'manage',
    permissions: ['offers.manage'], feature: 'offers', goKey: 'f' },
  { route: 'reports', href: '/reports', label: 'Reports', icon: 'stats-chart-outline', iconActive: 'stats-chart', roles: MANAGERS, group: 'business',
    permissions: ['reports.view', 'reports.view_own', 'staff.view'], feature: 'reports', goKey: 'r' },
  { route: 'watch', href: '/watch', label: "Owner's watch", short: 'Watch', icon: 'eye-outline', iconActive: 'eye', roles: ['owner'], group: 'business', ownerOnly: true,
    goKey: 'w' },
  { route: 'settings', href: '/settings', label: 'Settings', icon: 'settings-outline', iconActive: 'settings', roles: ALL, group: 'business', goKey: 's' },
];

export function visibleNavItems(role: Role | null, businessType: BusinessType | undefined, access: AccessInfo | null = null): NavItem[] {
  if (!role) return [];
  return NAV_ITEMS.filter((i) => {
    if (i.ownerOnly && role !== 'owner') return false;
    if (businessType && i.hideFor?.includes(businessType)) return false;
    if (!i.permissions && !i.feature) return access ? true : i.roles.includes(role);
    // Built-in role rules until the real permissions have loaded (first launch offline)
    return hasAccess(access, { permissions: i.permissions, feature: i.feature }) ?? i.roles.includes(role);
  });
}

/**
 * Phone bottom bar: up to four items, then "More". Primary items come first; a role or business type that hides some of
 * them (retail has no tables or kitchen) gets the next visible items instead, so the bar is never half empty.
 * When five or fewer items are visible they all fit and there is no "More".
 */
export function splitBottomBar(items: NavItem[]): { bar: NavItem[]; more: NavItem[] } {
  if (items.length <= 5) return { bar: items, more: [] };
  const primary = items.filter((i) => i.primary);
  const rest = items.filter((i) => !i.primary && i.route !== 'settings');
  const bar = [...primary, ...rest].slice(0, 4);
  const inBar = new Set(bar.map((i) => i.route));
  return { bar, more: items.filter((i) => !inBar.has(i.route)) };
}

/** "g" + key → item, for the desktop keyboard shortcuts. */
export function itemForGoKey(items: NavItem[], key: string): NavItem | undefined {
  const k = key.toLowerCase();
  return items.find((i) => i.goKey === k);
}
