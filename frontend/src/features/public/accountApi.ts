/**
 * Account deletion from the public web page. The shared API client always attaches the signed-in session's token,
 * but this page is usually used while signed out, so it calls the endpoint with the token from its own login.
 */
import { ApiError } from '@/api/client';
import { getServerUrl } from '@/store/prefs';

export async function deleteAccountWithToken(accessToken: string, password: string): Promise<{ success: boolean; business_closed: boolean }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  let response: Response;
  try {
    response = await fetch(`${getServerUrl()}/auth/delete-account`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ password, confirm: 'DELETE' }),
      signal: controller.signal,
    });
  } catch (e: any) {
    const timedOut = e?.name === 'AbortError';
    throw new ApiError(timedOut ? 'The server is taking too long to respond.' : 'Cannot reach the server. Check your internet connection.',
      0, timedOut ? 'TIMEOUT' : 'NETWORK', undefined, true);
  } finally {
    clearTimeout(timer);
  }
  let payload: any = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const message = typeof payload?.error?.message === 'string' ? payload.error.message
      : response.status === 401 ? 'Your sign-in expired. Please start again.'
      : response.status === 429 ? 'Too many attempts. Please wait a few minutes and try again.'
      : 'Could not delete the account. Please try again.';
    throw new ApiError(message, response.status, payload?.error?.code ?? 'HTTP_ERROR');
  }
  return payload as { success: boolean; business_closed: boolean };
}
