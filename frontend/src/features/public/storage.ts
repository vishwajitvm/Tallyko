/**
 * Tiny JSON storage for the customer-facing pages. Uses localStorage on the web (where these pages live) and an
 * in-memory map elsewhere. Every access is wrapped: private browsing, blocked cookies or a full quota must never
 * break ordering — the page simply forgets the cart on reload.
 */
import { Platform } from 'react-native';

const memory = new Map<string, string>();

function local(): Storage | null {
  if (Platform.OS !== 'web') return null;
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function readJson<T>(key: string): T | null {
  try {
    const raw = local()?.getItem(key) ?? memory.get(key) ?? null;
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeJson(key: string, value: unknown): void {
  const raw = JSON.stringify(value);
  memory.set(key, raw);
  try {
    local()?.setItem(key, raw);
  } catch {
    /* quota / blocked storage: keep the in-memory copy */
  }
}

export function removeKey(key: string): void {
  memory.delete(key);
  try {
    local()?.removeItem(key);
  } catch {
    /* ignore */
  }
}
