// @vitest-environment happy-dom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { indexUpgradesApi } from '@/lib/index-upgrades-api';
import { DocumentIndexStatus } from './document-index-status';
vi.mock('@/lib/index-upgrades-api', async (original) => ({
  ...(await original<any>()),
  indexUpgradesApi: { status: vi.fn() },
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
describe('document index state', () => {
  it('loads on request and distinguishes historical builds', async () => {
    vi.mocked(indexUpgradesApi.status).mockResolvedValue({
      version: 2,
      attempts: [
        {
          generation: 'g',
          pipeline: 'rag',
          version: 1,
          state: 'succeeded',
          stage: 'complete',
          completed: 2,
          total: 2,
          currentVersion: false,
        },
      ],
    });
    render(<DocumentIndexStatus documentId="doc" version={2} />);
    expect(indexUpgradesApi.status).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '查看状态' }));
    await screen.findByText(/历史版本 · 已激活/);
    expect(screen.queryByText(/当前版本 · 已激活/)).toBeNull();
  });
});
