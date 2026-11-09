import { describe, expect, it } from 'vitest';
import { ApiError, httpError, requestFailure } from './api-error';

describe('API error presentation', () => {
  it.each([
    [401, '登录已失效', false],
    [403, '权限', false],
    [404, '不存在', false],
    [409, '状态已发生变化', false],
    [413, '过大', false],
    [415, '格式', false],
    [408, '用时较长', true],
    [429, '频繁', true],
    [500, '服务暂时', true],
    [502, '服务暂时', true],
    [503, '服务暂时', true],
    [504, '用时较长', true],
  ])('maps status %i to actionable copy', (status, text, retryable) => {
    const error = httpError(status as number, {
      message: 'upstream database password=secret',
    });
    expect(error.message).toContain(text);
    expect(error.message).not.toContain('secret');
    expect(error.retryable).toBe(retryable);
    expect(error.status).toBe(status);
  });

  it('distinguishes rejected credentials from expired sessions', () => {
    expect(httpError(401, null, true).message).toContain('账号或密码不正确');
    expect(httpError(401, null).message).toContain('重新登录');
  });

  it('translates known validation arrays and document lifecycle errors', () => {
    const validation = httpError(400, {
      message: [
        'question must be a string',
        'question must be longer than or equal to 1 characters',
      ],
    });
    expect(validation.message).toBe('请输入文字问题。 请先输入你的问题。');
    expect(validation.retryable).toBe(false);
    expect(
      httpError(422, { message: 'document parsing is not ready' }).message,
    ).toContain('未解析完成');
  });

  it.each([
    null,
    'HTML error',
    [],
    { message: '<script>database failed</script>' },
    { message: { reason: 'internal' } },
    { message: ['file is required', 'private error'] },
    { message: 'constructor' },
    { message: '__proto__' },
  ])('uses a safe fallback for unknown response %j', (body) => {
    expect(httpError(400, body).message).toBe(
      '提交的内容不符合要求，请检查后再试。',
    );
  });

  it('does not trust a business-looking message from a server failure', () => {
    expect(httpError(500, { message: 'file is required' }).message).toContain(
      '服务暂时',
    );
    expect(httpError(418, { message: 'private error' }).message).not.toContain(
      'private',
    );
  });

  it('hides arbitrary client exceptions as well', () => {
    expect(
      requestFailure(new Error('stack with private data')).message,
    ).not.toContain('private');
    expect(
      requestFailure(new ApiError('无法连接服务', null, 'network', true)),
    ).toEqual({
      message: '无法连接服务',
      retryable: true,
    });
  });
});
