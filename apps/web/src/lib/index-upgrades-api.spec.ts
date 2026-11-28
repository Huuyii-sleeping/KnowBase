// @vitest-environment happy-dom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { authStorage } from './api';
import { indexUpgradesApi } from './index-upgrades-api';
afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});
describe('upgrade HTTP boundary', () => {
  it('does not send bulk operations or clear authentication in demo mode', async () => {
    sessionStorage.setItem('knowbase-mock', '1');
    sessionStorage.setItem('knowbase-access-token', 'demo');
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(
      indexUpgradesApi.preview({ intervalMs: 1000 }),
    ).rejects.toThrow('演示模式不执行索引升级');
    expect(fetch).not.toHaveBeenCalled();
    expect(authStorage.getToken()).toBe('demo');
  });
  it('sends a targeted retry and preserves 202 acceptance as acceptance', async () => {
    sessionStorage.setItem('knowbase-access-token', 'token');
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ accepted: true }), { status: 202 }),
      );
    vi.stubGlobal('fetch', fetch);
    expect(await indexUpgradesApi.command('plan', 'retry', 'task')).toEqual({
      accepted: true,
    });
    expect(fetch.mock.calls[0][0]).toBe(
      '/api/v1/index-upgrades/plan/tasks/task/retry',
    );
    expect(fetch.mock.calls[0][1].headers.get('Authorization')).toBe(
      'Bearer token',
    );
  });
});
