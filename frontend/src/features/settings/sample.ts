/** Sample bill and kitchen ticket for test prints and the live receipt preview. */
import type { BusinessSettings } from '@/api/types';
import type { KotData, ReceiptData } from '@/lib/print/receipt';
import { round2 } from '@/lib/format';

const ITEMS = [
  { name: 'Masala Dosa', variant: null, quantity: 2, unitPrice: 90 },
  { name: 'Paneer Butter Masala', variant: 'Full', quantity: 1, unitPrice: 240 },
  { name: 'Filter Coffee', variant: null, quantity: 2, unitPrice: 40 },
  { name: 'Butter Naan', variant: null, quantity: 3, unitPrice: 50 },
];

export function sampleReceipt(settings: BusinessSettings | null, fallbackName: string | null, cashier: string | null): ReceiptData {
  const rate = settings?.default_tax_rate ?? 5;
  const inclusive = !!settings?.prices_include_tax;
  const items = ITEMS.map((i) => ({ ...i, lineTotal: round2(i.unitPrice * i.quantity), taxRate: rate }));
  const subtotal = round2(items.reduce((s, i) => s + i.lineTotal, 0));
  const taxable = inclusive ? round2(subtotal / (1 + rate / 100)) : subtotal;
  const half = round2((taxable * rate) / 200);
  const taxTotal = round2(half * 2);
  const gross = inclusive ? subtotal : round2(subtotal + taxTotal);
  const total = Math.round(gross);
  return {
    business: {
      name: settings?.business_name || fallbackName || 'Your Business',
      address: settings?.address || 'Shop 4, MG Road, Bengaluru 560001',
      phone: settings?.phone || null,
      gstin: settings?.gstin || null,
      fssai: settings?.fssai || null,
      footer: settings?.receipt_footer || null,
      currencySymbol: settings?.currency_symbol || '₹',
      upiId: settings?.upi_id || null,
    },
    billNo: `${settings?.invoice_prefix || 'INV'}-TEST`,
    code: 'TEST123456',
    tokenNo: 42,
    createdAt: new Date().toISOString(),
    orderType: 'Dine-in',
    channel: null,
    tableLabel: 'T4',
    customerName: 'Sample Customer',
    customerPhone: '98765 43210',
    cashier,
    items,
    subtotal,
    discount: 0,
    taxBreakup: rate > 0 ? [{ rate, taxable, cgst: half, sgst: half }] : [],
    taxTotal: rate > 0 ? taxTotal : 0,
    roundOff: round2(total - gross),
    total,
    pricesIncludeTax: inclusive,
    payments: [{ method: 'UPI', amount: total }],
    loyaltyEarned: settings?.loyalty_enabled ? Math.floor(total / 100) * (settings.loyalty_points_per_100 || 0) || undefined : undefined,
  };
}

export function sampleKot(): KotData {
  return {
    kotNo: 'TEST',
    orderType: 'Dine-in',
    tableLabel: 'T4',
    tokenNo: 42,
    channel: null,
    brand: null,
    createdAt: new Date().toISOString(),
    items: [
      { name: 'Masala Dosa', quantity: 2, notes: 'Less oil' },
      { name: 'Paneer Butter Masala', variant: 'Full', quantity: 1 },
      { name: 'Butter Naan', quantity: 3 },
    ],
    notes: 'Test ticket from Settings',
  };
}
