import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RequestFailure } from './request-failure';

describe('request failure notice', () => {
  it('announces the failure with a recovery action', () => {
    const html = renderToStaticMarkup(
      <RequestFailure
        title="这次没能生成回答"
        message="服务暂时无法完成处理，请稍后重试。"
        onRetry={() => {}}
      />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain('这次没能生成回答');
    expect(html).toContain('重新尝试');
    expect(html).not.toContain('500');
  });
  it('does not offer retry for errors requiring corrected input or permissions', () => {
    const html = renderToStaticMarkup(
      <RequestFailure
        title="这次没能生成回答"
        message="你没有执行此操作的权限，请联系管理员。"
      />,
    );
    expect(html).not.toContain('<button');
  });
});
