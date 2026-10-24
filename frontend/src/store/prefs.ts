import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Platform } from 'react-native';
import { persistStorage } from '@/lib/storage';
import type { PaperWidth } from '@/lib/print/receipt';
import type { PrinterDevice } from '@/lib/print/printers';

/** Default API location. Web served behind our proxy uses the same origin; apps use the build-time URL. */
export function defaultServerUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) {
    const url = fromEnv.replace(/\/+$/, '');
    // Dev web opened from a phone on the LAN: "localhost" would mean the phone itself
    if (Platform.OS === 'web' && typeof window !== 'undefined' && /\/\/(localhost|127\.0\.0\.1)[:/]/.test(url)
        && !['localhost', '127.0.0.1'].includes(window.location.hostname)) {
      return url.replace(/\/\/(localhost|127\.0\.0\.1)/, `//${window.location.hostname}`);
    }
    // Relative path (production web behind Caddy): same origin
    if (url.startsWith('/') && Platform.OS === 'web' && typeof window !== 'undefined') return `${window.location.origin}${url}`;
    return url;
  }
  if (Platform.OS === 'web' && typeof window !== 'undefined') return `${window.location.origin}/api/v1`;
  return 'http://10.0.2.2:8000/api/v1'; // Android emulator -> host machine
}

export function normaliseServerUrl(input: string): string {
  let url = input.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  if (!/\/api\/v\d+$/.test(url)) url = `${url}/api/v1`;
  return url;
}

interface PrefsState {
  theme: 'system' | 'light' | 'dark';
  serverUrl: string | null; // null = default
  paperWidth: PaperWidth;
  printer: PrinterDevice | null;
  kitchenPrinter: PrinterDevice | null;
  autoPrintReceipt: boolean;
  autoPrintKot: boolean;
  printBarcodeOnBill: boolean;
  printQrOnBill: boolean;
  openCashDrawer: boolean;
  defaultOrderType: 'TAKEAWAY' | 'DINE_IN' | 'RETAIL_WALKIN';
  set: (patch: Partial<Omit<PrefsState, 'set'>>) => void;
}

export const usePrefs = create<PrefsState>()(
  persist(
    (set) => ({
      theme: 'system',
      serverUrl: null,
      paperWidth: 58,
      printer: null,
      kitchenPrinter: null,
      autoPrintReceipt: false,
      autoPrintKot: false,
      printBarcodeOnBill: true,
      printQrOnBill: true,
      openCashDrawer: false,
      defaultOrderType: 'TAKEAWAY',
      set: (patch) => set(patch),
    }),
    { name: 'tallyko.prefs', storage: persistStorage, version: 1 },
  ),
);

export function getServerUrl(): string {
  return usePrefs.getState().serverUrl || defaultServerUrl();
}
