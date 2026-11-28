import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createApiError, requestFailure } from '@/lib/api-error';
import type { ApiErrorCode } from '@/lib/error-catalog';
import { RequestFailure } from './request-failure';

function notice(code: ApiErrorCode, retry = true, refresh = true) {
  return renderToStaticMarkup(
    <RequestFailure
      title="这次操作未完成"
      failure={requestFailure(createApiError(code))}
      onRetry={retry ? () => {} : undefined}
      onRefresh={refresh ? () => {} : undefined}
    />,
  );
}

describe('request failure notice', () => {
  it('announces a safe message and an explicitly provided retry action', () => {
    const html = notice('SERVICE_UNAVAILABLE');
    expect(html).toContain('role="alert"');
    expect(html).toContain('服务暂时无法完成处理');
    expect(html).toContain('重新尝试');
    expect(html).toContain('type="button"');
    expect(html).not.toContain('500');
  });

  it.each([
    'FORBIDDEN',
    'VALIDATION_FAILED',
    'INVALID_CREDENTIALS',
    'UPLOAD_UNCONFIRMED',
  ] as const)(
    'does not offer retry or refresh for %s even when callbacks are supplied',
    (code) => {
      const html = notice(code);
      expect(html).not.toContain('重新尝试');
      expect(html).not.toContain('刷新状态');
      expect(html).not.toContain('<button');
    },
  );

  it('does not invent a retry action for write failures', () => {
    expect(notice('SERVICE_UNAVAILABLE', false)).not.toContain('<button');
  });

  it('offers login instead of retry for an expired session', () => {
    const html = notice('AUTH_REQUIRED');
    expect(html).toContain('href="/login"');
    expect(html).toContain('重新登录');
    expect(html).not.toContain('重新尝试');
  });

  it('offers refresh only when an explicit refresh callback is provided', () => {
    expect(notice('CONFLICT')).toContain('刷新状态');
    expect(notice('CONFLICT')).not.toContain('重新尝试');
    expect(notice('CONFLICT', true, false)).not.toContain('<button');
  });
});
