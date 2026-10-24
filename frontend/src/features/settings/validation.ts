/**
 * Client-side validation that mirrors the backend contracts (backend/app/api/admin.py, crm.py, auth.py),
 * so people see a clear message next to the field instead of a server error after pressing Save.
 */
import { ApiError } from '@/api/client';

export const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const FSSAI_PATTERN = /^[0-9]{14}$/;
export const UPI_PATTERN = /^[A-Za-z0-9._-]{2,64}@[A-Za-z]{2,32}$/;
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const INVOICE_PREFIX_PATTERN = /^[A-Za-z0-9-]{1,10}$/;
/** Backend PHONE_PATTERN (schemas/billing.py). */
export const PHONE_PATTERN = /^\+?[0-9 ]{6,16}$/;

const GST_STATES: Record<string, string> = {
  '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana',
  '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh',
  '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal',
  '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat', '26': 'Dadra & Nagar Haveli and Daman & Diu',
  '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu',
  '34': 'Puducherry', '35': 'Andaman & Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh', '97': 'Other territory',
};

/** GSTIN check digit (mod 36). Real GSTINs always pass; a mismatch usually means a typo. */
export function gstinChecksumOk(gstin: string): boolean {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = chars.indexOf(gstin[i]!);
    if (v < 0) return false;
    const product = v * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  const check = chars[(36 - (sum % 36)) % 36];
  return check === gstin[14];
}

export function validateGstin(value: string): { error?: string; hint?: string } {
  const v = value.trim().toUpperCase();
  if (!v) return {};
  if (v.length !== 15) return { error: `GSTIN has 15 characters (you entered ${v.length}).` };
  if (!GSTIN_PATTERN.test(v)) return { error: 'This does not look like a GSTIN. Format: 22AAAAA0000A1Z5.' };
  const state = GST_STATES[v.slice(0, 2)];
  if (!gstinChecksumOk(v)) return { hint: 'The last character does not match the GSTIN check digit. Please double-check for a typo.' };
  return { hint: state ? `Registered in ${state}` : undefined };
}

export function validateFssai(value: string): string | undefined {
  const v = value.trim();
  if (!v) return undefined;
  if (!/^\d+$/.test(v)) return 'FSSAI licence numbers contain digits only.';
  if (!FSSAI_PATTERN.test(v)) return `FSSAI licence number has 14 digits (you entered ${v.length}).`;
  return undefined;
}

export function validateUpi(value: string): string | undefined {
  const v = value.trim();
  if (!v) return undefined;
  if (!v.includes('@')) return 'A UPI ID looks like yourshop@okaxis or 9876543210@ybl.';
  if (!UPI_PATTERN.test(v)) return 'Check the UPI ID. Only letters, numbers, dot, dash and underscore before the @.';
  return undefined;
}

export function validateEmail(value: string, required = false): string | undefined {
  const v = value.trim();
  if (!v) return required ? 'Email is required.' : undefined;
  return EMAIL_PATTERN.test(v) ? undefined : 'Enter a valid email address.';
}

export function validatePhone(value: string, required = false): string | undefined {
  const v = value.trim();
  if (!v) return required ? 'Phone number is required.' : undefined;
  return PHONE_PATTERN.test(v.replace(/-/g, ' ')) ? undefined : 'Enter a valid phone number (digits only, 6 to 16).';
}

export function validatePassword(value: string): string | undefined {
  if (!value) return 'Password is required.';
  if (value.length < 8) return 'Use at least 8 characters.';
  if (value.length > 64) return 'Use 64 characters or fewer.';
  return undefined;
}

/**
 * Indian mobile numbers: accepts "98765 43210", "+91 98765-43210", "09876543210".
 * Returns the 10-digit number, or an international "+<digits>" number for foreign customers.
 */
export function normaliseMobile(input: string): { value: string | null; error?: string } {
  const raw = input.trim();
  if (!raw) return { value: null, error: 'Phone number is required.' };
  const digits = raw.replace(/[^\d]/g, '');
  if (raw.startsWith('+') && !raw.startsWith('+91')) {
    if (digits.length < 8 || digits.length > 15) return { value: null, error: 'Enter the full international number with country code.' };
    return { value: `+${digits}` };
  }
  let local = digits;
  if (local.length === 12 && local.startsWith('91')) local = local.slice(2);
  else if (local.length === 11 && local.startsWith('0')) local = local.slice(1);
  if (local.length !== 10) return { value: null, error: `Indian mobile numbers have 10 digits (you entered ${local.length}).` };
  if (!/^[6-9]/.test(local)) return { value: null, error: 'Indian mobile numbers start with 6, 7, 8 or 9.' };
  return { value: local };
}

/** "9876543210" → "98765 43210" for display. */
export function formatMobile(phone: string | null | undefined): string {
  if (!phone) return '';
  const p = phone.replace(/\s/g, '');
  if (/^\d{10}$/.test(p)) return `${p.slice(0, 5)} ${p.slice(5)}`;
  if (/^\+91\d{10}$/.test(p)) return `+91 ${p.slice(3, 8)} ${p.slice(8)}`;
  return phone;
}

/** wa.me needs the number with country code and no "+". */
export function whatsappUrl(phone: string): string | null {
  const p = phone.replace(/[^\d+]/g, '');
  if (/^\d{10}$/.test(p)) return `https://wa.me/91${p}`;
  if (/^0\d{10}$/.test(p)) return `https://wa.me/91${p.slice(1)}`;
  if (/^\+\d{8,15}$/.test(p)) return `https://wa.me/${p.slice(1)}`;
  if (/^91\d{10}$/.test(p)) return `https://wa.me/${p}`;
  return null;
}

const FIELD_FRIENDLY: Record<string, string> = {
  gstin: 'This does not look like a valid GSTIN.',
  fssai: 'FSSAI licence number must be 14 digits.',
  upi_id: 'Check the UPI ID format (name@bank).',
  email: 'Enter a valid email address.',
  phone: 'Enter a valid phone number.',
  invoice_prefix: 'Use 1 to 10 letters, numbers or dashes.',
  password: 'Use 8 to 64 characters.',
  default_tax_rate: 'GST rate must be between 0 and 28%.',
  loyalty_points_per_100: 'Use a whole number from 0 to 100.',
  loyalty_point_value: 'Use a value from 0 to 100.',
  low_stock_default: 'Use a whole number from 0 to 100000.',
  commission_pct: 'Use a value from 0 to 100.',
  price_adjust_pct: 'Use a value from -50 to 100.',
};

/** Maps a FastAPI 422 (`details[].loc = ['body', field]`) to `{ field: message }`. */
export function fieldErrorsFrom(e: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!(e instanceof ApiError) || e.status !== 422 || !Array.isArray(e.details)) return out;
  for (const d of e.details as { loc?: unknown[]; msg?: string }[]) {
    const field = Array.isArray(d.loc) ? String(d.loc[d.loc.length - 1] ?? '') : '';
    if (field && !out[field]) out[field] = FIELD_FRIENDLY[field] ?? d.msg ?? 'Invalid value.';
  }
  return out;
}

/** Strong-ish temporary password: no ambiguous characters (0/O, 1/l/I) so it can be read out loud. */
export function generatePassword(length = 10, random: (n: number) => Uint8Array): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = random(length);
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[bytes[i]! % alphabet.length];
  // Guarantee at least one digit so it reads as a "proper" password.
  if (!/\d/.test(out)) out = out.slice(0, -1) + String(2 + (bytes[0]! % 8));
  return out;
}
