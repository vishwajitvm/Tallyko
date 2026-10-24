import type { Ionicons } from '@expo/vector-icons';
import type { AccessInfo, Role } from '@/api/types';
import { hasAccess } from '@/store/access';

export type SettingsKey = 'overview' | 'business' | 'taxes' | 'printers' | 'channels' | 'qr' | 'floor' | 'brands' | 'staff' | 'emails' | 'modules' | 'billing' | 'account';

export interface SettingsSection {
  key: SettingsKey;
  href: string;
  label: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  roles: Role[];
  /** Once /access/me has loaded these decide (any permission + the module); before that, `roles` */
  permissions?: string[];
  feature?: string;
  ownerOnly?: boolean;
}

const ALL: Role[] = ['owner', 'manager', 'cashier', 'waiter', 'kitchen'];
const MANAGERS: Role[] = ['owner', 'manager'];

export const SETTINGS_SECTIONS: SettingsSection[] = [
  { key: 'overview', href: '/settings', label: 'Overview', description: 'Setup checklist and app details', icon: 'grid-outline', roles: ALL },
  { key: 'business', href: '/settings/business', label: 'Business', description: 'Profile, UPI, loyalty, online ordering', icon: 'storefront-outline', roles: MANAGERS,
    permissions: ['settings.manage'] },
  { key: 'taxes', href: '/settings/taxes', label: 'GST & taxes', description: 'Tax classes, CGST/SGST, rate changes', icon: 'calculator-outline', roles: MANAGERS,
    permissions: ['settings.manage'] },
  { key: 'printers', href: '/settings/printers', label: 'Printers & receipts', description: 'Bluetooth printers, paper size, test print', icon: 'print-outline', roles: ALL },
  { key: 'channels', href: '/settings/channels', label: 'Sales channels', description: 'Swiggy, Zomato, ONDC, magicpin, QR, store', icon: 'git-network-outline', roles: MANAGERS,
    permissions: ['channels.manage'] },
  { key: 'qr', href: '/settings/qr', label: 'QR table ordering', description: 'Guests scan, order and pay from their table', icon: 'qr-code-outline',
    roles: MANAGERS, permissions: ['settings.manage'] },
  { key: 'floor', href: '/settings/floor', label: 'Floor alerts', description: 'When tables, kitchen tickets and online orders turn amber and red',
    icon: 'alarm-outline', roles: MANAGERS, permissions: ['settings.manage'] },
  { key: 'brands', href: '/settings/brands', label: 'Brands', description: 'Virtual brands for cloud kitchens', icon: 'pricetags-outline', roles: MANAGERS,
    permissions: ['settings.manage'] },
  { key: 'staff', href: '/settings/staff', label: 'Staff & roles', description: 'Team logins, permissions, waiter performance, activity log', icon: 'people-outline', roles: MANAGERS,
    permissions: ['staff.view', 'staff.manage', 'audit.view'] },
  { key: 'emails', href: '/settings/emails', label: 'Customer emails', description: 'Reward, offer and receipt email templates', icon: 'mail-outline', roles: MANAGERS,
    permissions: ['email.manage'], feature: 'email' },
  { key: 'modules', href: '/settings/modules', label: 'Modules & plan', description: 'Your plan and the modules you use', icon: 'apps-outline', roles: ['owner'],
    ownerOnly: true },
  { key: 'billing', href: '/settings/billing', label: 'Plan & billing', description: 'Your subscription, renewal and payments', icon: 'card-outline', roles: ['owner'],
    ownerOnly: true },
  { key: 'account', href: '/settings/account', label: 'Account', description: 'Profile, password, appearance, sign out', icon: 'person-circle-outline', roles: ALL },
];

export function sectionsFor(role: Role | null, access: AccessInfo | null = null): SettingsSection[] {
  if (!role) return [];
  return SETTINGS_SECTIONS.filter((s) => {
    if (s.ownerOnly) return role === 'owner';
    if (!s.permissions && !s.feature) return true;
    return hasAccess(access, { permissions: s.permissions, feature: s.feature }) ?? s.roles.includes(role);
  });
}

export const ROLE_LABEL: Record<Role, string> = {
  owner: 'Owner', manager: 'Manager', cashier: 'Cashier', waiter: 'Waiter', kitchen: 'Kitchen',
};

export const ROLE_DESCRIPTION: Record<Role, string> = {
  owner: 'Everything, including staff, settings, reports and closing the business account.',
  manager: 'Runs the shop: menu, stock, reports, settings and cashier/waiter/kitchen logins.',
  cashier: 'Takes orders, collects payment, prints bills and manages customers.',
  waiter: 'Takes table orders and sends them to the kitchen. Cannot take payment.',
  kitchen: 'Sees the kitchen display and marks tickets as preparing or ready.',
};
