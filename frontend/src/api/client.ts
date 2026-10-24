import { getServerUrl } from '@/store/prefs';

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
  /** True when the server could not be reached at all (offline / wrong server address). */
  network: boolean;

  constructor(message: string, status = 0, code = 'ERROR', details?: unknown, network = false) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.network = network;
  }
}

export function errorMessage(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export function isOffline(error: unknown): boolean {
  return error instanceof ApiError && error.network;
}

/** The business's Tallyko subscription has ended (HTTP 402): the app shows the renewal page. */
export function isPaymentRequired(error: unknown): boolean {
  return error instanceof ApiError && error.status === 402;
}

type TokenProvider = {
  getAccessToken: () => string | null;
  refresh: () => Promise<boolean>;
  /** Still 401 after trying to refresh: the session is over. `message` is the server's reason. */
  onUnauthorized: (message?: string) => void;
  /** A signed-in request answered 402 (subscription ended). */
  onPaymentRequired?: (message: string) => void;
};

let tokens: TokenProvider = {
  getAccessToken: () => null,
  refresh: async () => false,
  onUnauthorized: () => {},
};

export function configureAuth(provider: TokenProvider) {
  tokens = provider;
}

let refreshing: Promise<boolean> | null = null;

function refreshOnce(): Promise<boolean> {
  if (!refreshing) {
    refreshing = tokens.refresh().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

export interface RequestOptions {
  body?: unknown;
  query?: Record<string, string | number | boolean | null | undefined>;
  auth?: boolean;
  timeoutMs?: number;
  /** FormData uploads (menu photos) */
  form?: FormData;
  baseUrl?: string;
}

function parseError(status: number, payload: any): ApiError {
  const err = payload?.error;
  let message: string = typeof err?.message === 'string' ? err.message : '';
  if (!message && err?.message && typeof err.message === 'object') message = err.message.message || JSON.stringify(err.message);
  if (!message && typeof payload?.detail === 'string') message = payload.detail;
  if (!message) {
    message =
      status === 401 ? 'Please sign in again.'
      : status === 403 ? 'You do not have permission to do this.'
      : status === 404 ? 'Not found.'
      : status === 429 ? 'Too many attempts. Please wait a minute.'
      : status >= 500 ? 'The server had a problem. Please try again.'
      : 'Request failed.';
  }
  return new ApiError(message, status, err?.code || 'HTTP_ERROR', err?.details ?? err?.message);
}

/** A parsed JSON body together with the response headers (paging totals, counts). */
export interface ApiResponse<T> {
  data: T;
  headers: Headers;
}

/** Reads a numeric header such as `X-Total-Count`; `undefined` when absent or not a number. */
export function headerNumber(headers: Headers, name: string): number | undefined {
  const raw = headers.get(name);
  if (raw == null || raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/** Reads a JSON header such as `X-Counts`; `undefined` when absent or malformed. */
export function headerJson<T = any>(headers: Headers, name: string): T | undefined {
  const raw = headers.get(name);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

export async function request<T = any>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
  return (await requestWithMeta<T>(method, path, opts)).data;
}

export async function requestWithMeta<T = any>(method: string, path: string, opts: RequestOptions = {}): Promise<ApiResponse<T>> {
  const { body, query, auth = true, timeoutMs = 20000, form, baseUrl } = opts;
  let url = `${baseUrl ?? getServerUrl()}${path}`;
  if (query) {
    const params = Object.entries(query)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    if (params.length) url += `${url.includes('?') ? '&' : '?'}${params.join('&')}`;
  }

  const attempt = async (): Promise<Response> => {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (!form) headers['Content-Type'] = 'application/json';
    const token = auth ? tokens.getAccessToken() : null;
    if (token) headers.Authorization = `Bearer ${token}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, {
        method,
        headers,
        body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
        signal: controller.signal,
      });
    } catch (e: any) {
      const timedOut = e?.name === 'AbortError';
      throw new ApiError(
        timedOut ? 'The server is taking too long to respond.' : 'Cannot reach the server. Check your internet connection.',
        0, timedOut ? 'TIMEOUT' : 'NETWORK', undefined, true,
      );
    } finally {
      clearTimeout(timer);
    }
  };

  const signedIn = auth && !!tokens.getAccessToken();
  let response = await attempt();
  let unauthorized = false;
  if (response.status === 401 && signedIn) {
    const refreshed = await refreshOnce();
    if (refreshed) response = await attempt();
    unauthorized = response.status === 401;
  }

  const text = await response.text();
  let payload: any = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }
  if (!response.ok) {
    const error = parseError(response.status, payload);
    if (unauthorized) tokens.onUnauthorized(error.message);
    // Only signed-in calls lock the app: a public page (customer ordering) of a lapsed shop must not
    if (response.status === 402 && signedIn) tokens.onPaymentRequired?.(error.message);
    throw error;
  }
  return { data: payload as T, headers: response.headers };
}

export const api = {
  get: <T = any>(path: string, opts?: RequestOptions) => request<T>('GET', path, opts),
  /** Like `get`, but also returns the response headers (`X-Total-Count`, `X-Counts`). */
  getWithMeta: <T = any>(path: string, opts?: RequestOptions) => requestWithMeta<T>('GET', path, opts),
  post: <T = any>(path: string, body?: unknown, opts?: RequestOptions) => request<T>('POST', path, { ...opts, body }),
  put: <T = any>(path: string, body?: unknown, opts?: RequestOptions) => request<T>('PUT', path, { ...opts, body }),
  delete: <T = any>(path: string, opts?: RequestOptions) => request<T>('DELETE', path, opts),
};
