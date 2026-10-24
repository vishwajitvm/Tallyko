/**
 * "Search settings": every setting people look for by a word (gst, upi, printer, swiggy, password…) points at the page
 * and, where a page has sections, the section. Pure data + matching so it is unit-tested.
 */
import type { Ionicons } from '@expo/vector-icons';
import type { SettingsKey, SettingsSection } from './sections';

export interface SettingsTopic {
  section: SettingsKey;
  title: string;
  /** Where it lives, e.g. "Business › Payments" */
  hint?: string;
  href: string;
  keywords: string;
  icon?: keyof typeof Ionicons.glyphMap;
}

export const SETTINGS_TOPICS: SettingsTopic[] = [
  { section: 'business', title: 'Business profile', hint: 'Business', href: '/settings/business?section=profile',
    keywords: 'name shop address phone email contact logo bill header city pincode', icon: 'storefront-outline' },
  { section: 'business', title: 'GSTIN, FSSAI & invoices', hint: 'Business', href: '/settings/business?section=tax',
    keywords: 'gst gstin fssai invoice bill footer registration composition tax inclusive prices include gst', icon: 'document-text-outline' },
  { section: 'business', title: 'UPI & payments', hint: 'Business', href: '/settings/business?section=payments',
    keywords: 'upi vpa qr payment gpay phonepe paytm bank pay', icon: 'qr-code-outline' },
  { section: 'business', title: 'Loyalty points', hint: 'Business', href: '/settings/business?section=loyalty',
    keywords: 'loyalty points rewards redeem regular customers', icon: 'gift-outline' },
  { section: 'business', title: 'Online store', hint: 'Business', href: '/settings/business?section=online',
    keywords: 'online store ordering delivery takeaway website link share poster', icon: 'globe-outline' },
  { section: 'business', title: 'Low-stock level', hint: 'Business', href: '/settings/business?section=inventory',
    keywords: 'inventory stock low stock alert threshold', icon: 'cube-outline' },
  { section: 'taxes', title: 'GST rates & tax classes', hint: 'GST & taxes', href: '/settings/taxes',
    keywords: 'gst tax rate class hsn sac cgst sgst igst cess 5% 12% 18% 28% rate change slab', icon: 'calculator-outline' },
  { section: 'printers', title: 'Receipt printer', hint: 'Printers & receipts', href: '/settings/printers',
    keywords: 'printer print bluetooth thermal receipt bill test print usb pair 58mm 80mm paper width', icon: 'print-outline' },
  { section: 'printers', title: 'Kitchen printer & KOT', hint: 'Printers & receipts', href: '/settings/printers',
    keywords: 'kot kitchen ticket printer auto print', icon: 'flame-outline' },
  { section: 'printers', title: 'Receipt options', hint: 'Printers & receipts', href: '/settings/printers',
    keywords: 'barcode on bill upi qr on bill cash drawer auto print after payment', icon: 'receipt-outline' },
  { section: 'channels', title: 'Swiggy, Zomato & other apps', hint: 'Sales channels', href: '/settings/channels',
    keywords: 'swiggy zomato ondc magicpin aggregator channel commission webhook delivery apps price per channel', icon: 'git-network-outline' },
  { section: 'qr', title: 'QR table ordering', hint: 'QR table ordering', href: '/settings/qr',
    keywords: 'qr table scan dine-in guests order from table poster pay at table', icon: 'qr-code-outline' },
  { section: 'floor', title: 'Floor alert times', hint: 'Floor alerts', href: '/settings/floor',
    keywords: 'alert alerts amber red late table time kitchen ticket kot delay online order waiting minutes colour color warning', icon: 'alarm-outline' },
  { section: 'brands', title: 'Brands', hint: 'Brands', href: '/settings/brands',
    keywords: 'brand virtual brand cloud kitchen', icon: 'pricetags-outline' },
  { section: 'staff', title: 'Staff logins', hint: 'Staff & roles', href: '/settings/staff',
    keywords: 'staff team users employees cashier waiter kitchen login add staff deactivate password tables assign', icon: 'people-outline' },
  { section: 'staff', title: 'Roles & permissions', hint: 'Staff & roles', href: '/settings/staff',
    keywords: 'role roles permission permissions access rights custom role manager', icon: 'shield-half-outline' },
  { section: 'staff', title: 'Activity log', hint: 'Staff & roles', href: '/settings/staff',
    keywords: 'activity audit log who did what history', icon: 'time-outline' },
  { section: 'emails', title: 'Customer emails', hint: 'Customer emails', href: '/settings/emails',
    keywords: 'email emails template receipt email offer reward mail', icon: 'mail-outline' },
  { section: 'modules', title: 'Modules', hint: 'Modules & plan', href: '/settings/modules',
    keywords: 'modules features turn off hide inventory kitchen tables customers offers', icon: 'apps-outline' },
  { section: 'billing', title: 'Tallyko subscription', hint: 'Plan & billing', href: '/settings/billing',
    keywords: 'plan subscription renew payment tallyko invoice trial demo devices upgrade', icon: 'card-outline' },
  { section: 'account', title: 'Password', hint: 'Account', href: '/settings/account',
    keywords: 'password change password login', icon: 'key-outline' },
  { section: 'account', title: 'Appearance', hint: 'Account', href: '/settings/account',
    keywords: 'theme dark mode light mode appearance', icon: 'contrast-outline' },
  { section: 'account', title: 'Sign out & delete account', hint: 'Account', href: '/settings/account',
    keywords: 'sign out logout delete account privacy server sync', icon: 'log-out-outline' },
];

function norm(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}%]+/gu, ' ').trim();
}

/**
 * Topics matching the query (every word must match the start of a word in the title, place or keywords), limited to
 * the sections this person can open. Title matches rank first.
 */
export function searchSettings(query: string, sections: Pick<SettingsSection, 'key' | 'label'>[], limit = 8): SettingsTopic[] {
  const words = norm(query).split(' ').filter(Boolean);
  if (!words.length) return [];
  const allowed = new Set(sections.map((s) => s.key));
  const scored: { t: SettingsTopic; score: number }[] = [];
  for (const t of SETTINGS_TOPICS) {
    if (!allowed.has(t.section)) continue;
    const title = norm(t.title);
    const hay = ` ${title} ${norm(t.hint ?? '')} ${norm(t.keywords)}`;
    if (!words.every((w) => hay.includes(` ${w}`))) continue;
    const score = words.reduce((n, w) => n + (` ${title}`.includes(` ${w}`) ? 2 : 1), 0);
    scored.push({ t, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((s) => s.t);
}

/** Sections whose label matches (the left list filters itself as you type). */
export function matchSections<T extends Pick<SettingsSection, 'key' | 'label' | 'description'>>(query: string, sections: T[]): T[] {
  const words = norm(query).split(' ').filter(Boolean);
  if (!words.length) return sections;
  const hits = new Set(searchSettings(query, sections, 50).map((t) => t.section));
  return sections.filter((s) => {
    const hay = ` ${norm(s.label)} ${norm(s.description)}`;
    return hits.has(s.key) || words.every((w) => hay.includes(` ${w}`));
  });
}
