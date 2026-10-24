/// <reference types="jest" />
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
import { api, headerJson, headerNumber } from '@/api/client';

const headers = (h: Record<string, string>) => ({ get: (k: string) => h[k] ?? h[k.toLowerCase()] ?? null }) as unknown as Headers;

describe('response headers', () => {
  it('reads paging totals and JSON counts', () => {
    const h = headers({ 'X-Total-Count': '3000', 'X-Counts': '{"Gold":12,"Silver":80,"Bronze":2908,"all":3000}' });
    expect(headerNumber(h, 'X-Total-Count')).toBe(3000);
    expect(headerJson(h, 'X-Counts')).toEqual({ Gold: 12, Silver: 80, Bronze: 2908, all: 3000 });
  });

  it('is undefined when missing or malformed', () => {
    const h = headers({ 'X-Total-Count': 'many', 'X-Counts': '{oops' });
    expect(headerNumber(h, 'X-Total-Count')).toBeUndefined();
    expect(headerJson(h, 'X-Counts')).toBeUndefined();
    expect(headerNumber(headers({}), 'X-Total-Count')).toBeUndefined();
  });

  it('getWithMeta returns the body and the headers; get still returns the body', async () => {
    const realFetch = global.fetch;
    global.fetch = jest.fn(async () => ({
      ok: true, status: 200, text: async () => '[{"id":"c1"}]', headers: headers({ 'X-Total-Count': '1' }),
    })) as unknown as typeof fetch;
    try {
      const { data, headers: h } = await api.getWithMeta<{ id: string }[]>('/crm/customers', { auth: false, baseUrl: 'http://x' });
      expect(data).toEqual([{ id: 'c1' }]);
      expect(headerNumber(h, 'X-Total-Count')).toBe(1);
      expect(await api.get('/crm/customers', { auth: false, baseUrl: 'http://x' })).toEqual([{ id: 'c1' }]);
    } finally {
      global.fetch = realFetch;
    }
  });
});
