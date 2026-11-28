import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './api-error';
import { requestJson } from './http-request';

afterEach(() => vi.unstubAllGlobals());

describe('JSON transport', () => {
  it('passes headers and payload through and parses a successful response', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ answer: '知识库回答' })),
      );
    vi.stubGlobal('fetch', fetch);
    const init = {
      method: 'POST',
      headers: { Authorization: 'Bearer test' },
      body: '{"question":"RAG?"}',
    };
    const clear = vi.fn();
    expect(await requestJson('/api/v1/rag/answer', init, clear)).toEqual({
      answer: '知识库回答',
    });
    expect(fetch).toHaveBeenCalledWith('/api/v1/rag/answer', init);
    expect(clear).not.toHaveBeenCalled();
  });

  it('supports no-content mutation responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
    );
    expect(
      await requestJson('/api/v1/documents/1', { method: 'DELETE' }, vi.fn()),
    ).toBeUndefined();
  });

  it.each([
    '<html>private upstream error</html>',
    '',
    JSON.stringify({ message: 'Connection failed: internal.host' }),
  ])('handles JSON, empty and proxy HTML failures safely', async (body) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(body, { status: 500 })),
    );
    await expect(
      requestJson('/api/v1/rag/answer', {}, vi.fn()),
    ).rejects.toMatchObject({
      status: 500,
      kind: 'http',
      retryable: true,
      message: '服务暂时无法完成处理，请稍后重试。',
    });
  });

  it('clears stale authentication and keeps login errors understandable', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(async () => new Response('{}', { status: 401 })),
    );
    const clear = vi.fn();
    await expect(
      requestJson('/api/v1/auth/me', {}, clear),
    ).rejects.toMatchObject({ message: '登录已失效，请重新登录后继续。' });
    expect(clear).toHaveBeenCalledOnce();
    await expect(
      requestJson('/api/v1/auth/login', {}, clear),
    ).rejects.toMatchObject({ message: '账号或密码不正确，请重新输入。' });
  });

  it.each([
    [new TypeError('Failed to fetch internal.host'), 'network'],
    [new DOMException('aborted internal.host', 'AbortError'), 'timeout'],
    [new DOMException('timeout internal.host', 'TimeoutError'), 'timeout'],
  ])('normalizes transport failures', async (reason, kind) => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(reason));
    const clear = vi.fn();
    try {
      await requestJson('/api/v1/rag/answer', {}, clear);
      expect.fail('must reject');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ status: null, kind, retryable: true });
      expect((error as Error).message).not.toContain('internal.host');
    }
    expect(clear).not.toHaveBeenCalled();
  });

  it('handles an unreadable successful response without exposing parser errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('private invalid JSON')),
    );
    await expect(
      requestJson('/api/v1/rag/answer', {}, vi.fn()),
    ).rejects.toMatchObject({ kind: 'response', retryable: true });
  });
});
