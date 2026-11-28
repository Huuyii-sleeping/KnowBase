import { createApiError, httpError } from './api-error';

export async function requestJson<T>(
  url: string,
  init: RequestInit,
  onUnauthorized: () => void,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    if (
      error instanceof Error &&
      ['AbortError', 'TimeoutError'].includes(error.name)
    )
      throw createApiError('REQUEST_INTERRUPTED', { kind: 'timeout' });
    throw createApiError('NETWORK_ERROR', { kind: 'network' });
  }
  if (!response.ok) {
    if (response.status === 401) onUnauthorized();
    const body: unknown = await response.json().catch(() => null);
    throw httpError(response.status, body, url === '/api/v1/auth/login');
  }
  if (response.status === 204) return undefined as T;
  try {
    return (await response.json()) as T;
  } catch {
    throw createApiError('INVALID_RESPONSE', {
      status: response.status,
      kind: 'response',
    });
  }
}
