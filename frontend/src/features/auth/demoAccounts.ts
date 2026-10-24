/**
 * Demo logins created by `python manage.py seed` (keep in sync with backend/app/db/seeders/demo_data.py). They only exist on servers where the seed ran,
 * and the picker is shown only in development builds or when EXPO_PUBLIC_DEMO_LOGINS=true.
 */
import type { PlatformRole, Role } from '@/api/types';

export type DemoRole = Role | PlatformRole;

export const DEMO_PASSWORD = 'Demo@1234';

export interface DemoAccount {
  email: string;
  name: string;
  role: DemoRole;
  business: string;
  note: string;
}

export const DEMO_ACCOUNTS: DemoAccount[] = [
  { email: 'superadmin@example.com', name: 'Tallyko Super Admin', role: 'super_admin', business: 'Tallyko platform', note: 'Businesses, plans, payments, features' },
  { email: 'superadmin2@example.com', name: 'Priya Nair', role: 'super_admin', business: 'Tallyko platform', note: 'Businesses, plans, payments, features' },
  { email: 'support@example.com', name: 'Tallyko Support', role: 'support', business: 'Tallyko platform', note: 'Read-only console' },
  { email: 'support2@example.com', name: 'Arjun Rao', role: 'support', business: 'Tallyko platform', note: 'Read-only console' },
  { email: 'owner.dhaba@example.com', name: 'Rajesh Sharma', role: 'owner', business: 'Sharma Da Dhaba', note: 'Restaurant · everything' },
  { email: 'owner.store@example.com', name: 'Sunita Gupta', role: 'owner', business: 'Gupta General Store', note: 'Retail · barcodes & stock' },
  { email: 'owner.cloud@example.com', name: 'Farhan Qureshi', role: 'owner', business: 'Biryani Box Cloud Kitchen', note: 'Swiggy & Zomato · own prices & menus' },
  { email: 'owner.expired@example.com', name: 'Vikram Singh', role: 'owner', business: 'Chai Point Café', note: 'Subscription ended · renewal screen' },
  { email: 'manager1@example.com', name: 'Anil Kumar', role: 'manager', business: 'Sharma Da Dhaba', note: 'Menu, staff, reports' },
  { email: 'manager2@example.com', name: 'Pooja Mehta', role: 'manager', business: 'Sharma Da Dhaba', note: 'Menu, staff, reports' },
  { email: 'cloud.manager@example.com', name: 'Sana Khan', role: 'manager', business: 'Biryani Box Cloud Kitchen', note: 'Online orders, menus per app' },
  { email: 'cashier1@example.com', name: 'Ravi Yadav', role: 'cashier', business: 'Sharma Da Dhaba', note: 'Billing & payments' },
  { email: 'cashier2@example.com', name: 'Neha Joshi', role: 'cashier', business: 'Sharma Da Dhaba', note: 'Billing & payments' },
  { email: 'cashier.expired@example.com', name: 'Anita Rao', role: 'cashier', business: 'Chai Point Café', note: 'Locked business · ask the owner' },
  { email: 'waiter1@example.com', name: 'Suresh Pal', role: 'waiter', business: 'Sharma Da Dhaba', note: 'Tables & orders, no payments' },
  { email: 'waiter2@example.com', name: 'Mohan Lal', role: 'waiter', business: 'Sharma Da Dhaba', note: 'Tables & orders, no payments' },
  { email: 'kitchen1@example.com', name: 'Ramesh (Head chef)', role: 'kitchen', business: 'Sharma Da Dhaba', note: 'Kitchen display only' },
  { email: 'kitchen2@example.com', name: 'Imran (Tandoor)', role: 'kitchen', business: 'Sharma Da Dhaba', note: 'Kitchen display only' },
  { email: 'cloud.kitchen@example.com', name: 'Ramu (Biryani master)', role: 'kitchen', business: 'Biryani Box Cloud Kitchen', note: 'Kitchen display only' },
];

export const ROLE_LABEL: Record<DemoRole, string> = {
  super_admin: 'Super admin', support: 'Support',
  owner: 'Owner', manager: 'Manager', cashier: 'Cashier', waiter: 'Waiter', kitchen: 'Kitchen',
};

export function demoLoginsEnabled(): boolean {
  return __DEV__ || process.env.EXPO_PUBLIC_DEMO_LOGINS === 'true';
}
