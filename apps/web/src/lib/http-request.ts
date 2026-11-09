import { ApiError, httpError } from './api-error';

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
      throw new ApiError('这次请求已中断，请重试。', null, 'timeout', true);
    throw new ApiError(
      '无法连接服务，请检查网络连接后重试。',
      null,
      'network',
      true,
    );
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
    throw new ApiError(
      '暂时无法读取处理结果，请稍后重试。',
      response.status,
      'response',
      true,
    );
  }
}
