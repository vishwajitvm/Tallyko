/**
 * GSTIN (GST identification number) validation — mirrors backend/app/core/gstin.py exactly, so the app can tell the
 * shopkeeper about a typo before the server does.
 *
 * Format (15 characters): 2-digit state code · 10-character PAN · entity number (1-9, A-Z) · "Z" · check character.
 * The check character is the GSTN mod-36 checksum. GST is charged only when the registration is "regular" AND the
 * GSTIN is valid; everyone else issues a Bill of Supply.
 */

export type GstRegistration = 'regular' | 'composition' | 'unregistered';

const CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const PATTERN = /^([0-9]{2})([A-Z]{5}[0-9]{4}[A-Z])([1-9A-Z])Z([0-9A-Z])$/;

export const GST_STATES: Readonly<Record<string, string>> = {
  '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana',
  '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh',
  '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal',
  '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat',
  '26': 'Dadra & Nagar Haveli and Daman & Diu', '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep',
  '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman & Nicobar Islands', '36': 'Telangana',
  '37': 'Andhra Pradesh', '38': 'Ladakh', '97': 'Other Territory', '99': 'Centre Jurisdiction',
};

/** Mod-36 check character for the first 14 characters (already normalised). */
export function gstinCheckChar(first14: string): string {
  let total = 0;
  for (let i = 0; i < first14.length; i++) {
    const index = CHARSET.indexOf(first14[i]!);
    if (index < 0) return '';
    const product = index * (i % 2 ? 2 : 1);
    total += Math.floor(product / 36) + (product % 36);
  }
  return CHARSET[(36 - (total % 36)) % 36]!;
}

/** Removes spaces and dashes, upper-cases. Empty input gives "". */
export function normalizeGstin(value: string | null | undefined): string {
  return (value ?? '').replace(/[\s-]/g, '').toUpperCase();
}

export interface GstinCheck {
  ok: boolean;
  /** Normalised value */
  gstin: string;
  /** Message for a shopkeeper (same wording as the server) */
  error?: string;
  /** State the GSTIN is registered in, when valid */
  state?: string;
}

export function checkGstin(value: string | null | undefined): GstinCheck {
  const gstin = normalizeGstin(value);
  if (!gstin) return { ok: false, gstin, error: 'Enter your GSTIN' };
  if (gstin.length !== 15) return { ok: false, gstin, error: 'A GSTIN has 15 characters' };
  const match = PATTERN.exec(gstin);
  if (!match) return { ok: false, gstin, error: "This doesn't look like a GSTIN (e.g. 27ABCDE1234F1Z5)" };
  const code = match[1]!;
  if (!GST_STATES[code]) return { ok: false, gstin, error: `${code} isn't a valid state code` };
  if (gstinCheckChar(gstin.slice(0, 14)) !== gstin[14]) {
    return { ok: false, gstin, error: "This GSTIN has a typo (its last character doesn't match). Check it on your GST certificate" };
  }
  return { ok: true, gstin, state: GST_STATES[code] };
}

export function isValidGstin(value: string | null | undefined): boolean {
  return checkGstin(value).ok;
}

export function gstinState(value: string | null | undefined): string | null {
  return checkGstin(value).state ?? null;
}

/** Same rule as the server: only a regular registration with a valid GSTIN charges GST. */
export function chargesGst(registration: GstRegistration | string | null | undefined, gstin: string | null | undefined): boolean {
  return (registration || 'regular') === 'regular' && isValidGstin(gstin);
}
