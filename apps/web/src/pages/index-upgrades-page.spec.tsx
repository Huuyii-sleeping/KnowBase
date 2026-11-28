// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { indexUpgradesApi as api } from '@/lib/index-upgrades-api';
import { IndexUpgradesPage } from './index-upgrades-page';
vi.mock('@/lib/index-upgrades-api', async (original) => ({
  ...(await original<any>()),
  indexUpgradesApi: {
    list: vi.fn(),
    preview: vi.fn(),
    summary: vi.fn(),
    items: vi.fn(),
    command: vi.fn(),
    attempts: vi.fn(),
  },
}));
const summary = {
  plan: {
    id: 'plan',
    state: 'preview',
    target_hash: 'hash',
    interval_ms: 1000,
    target: { chunkStrategy: 'structure-v4' },
  },
  classifications: [{ classification: 'rebuild', count: 1 }],
  documents: [{ state: 'pending', count: 1 }],
  tasks: [],
  activeDocuments: 0,
};
beforeEach(() => {
  vi.mocked(api.list).mockResolvedValue([summary.plan] as any);
  vi.mocked(api.preview).mockResolvedValue(summary as any);
  vi.mocked(api.summary).mockResolvedValue(summary as any);
  vi.mocked(api.items).mockResolvedValue([
    {
      id: 'item',
      document_id: 'doc',
      title: '合成业务资料',
      version: 1,
      classification: 'rebuild',
      previous_strategy: 'unknown',
      tasks: [
        {
          id: 'task',
          pipeline: 'rag',
          state: 'dispatched',
          active: false,
          errorCode: null,
        },
      ],
    },
  ] as any);
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
describe('upgrade management page', () => {
  it('previews without starting and distinguishes submission from activation', async () => {
    render(
      <MemoryRouter>
        <IndexUpgradesPage />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: '生成升级预览' }));
    await screen.findByRole('button', { name: '启动批次' });
    expect(api.command).not.toHaveBeenCalled();
    expect(screen.getByText('向量：已提交')).toBeTruthy();
    expect(screen.queryByText('向量：已激活')).toBeNull();
    expect(screen.getByText('当前三条索引均有效 0')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '启动批次' }));
    await waitFor(() =>
      expect(api.command).toHaveBeenCalledWith('plan', 'start', undefined),
    );
  });
  it('keeps partial and uncertain pipelines visible rather than declaring success', async () => {
    vi.mocked(api.summary).mockResolvedValue({
      ...summary,
      plan: { ...summary.plan, state: 'completed' },
      documents: [{ state: 'activation_unknown', count: 1 }],
    } as any);
    vi.mocked(api.items).mockResolvedValue([
      {
        id: 'item',
        document_id: 'doc',
        title: '资料',
        version: 1,
        classification: 'rebuild',
        previous_strategy: 'unknown',
        tasks: [
          { id: '1', pipeline: 'search', state: 'succeeded', active: true },
          {
            id: '2',
            pipeline: 'rag',
            state: 'activation_unknown',
            active: false,
            errorCode: 'ACTIVATION_UNKNOWN',
          },
          {
            id: '3',
            pipeline: 'kg',
            state: 'failed',
            errorCode: 'BUILD_FAILED',
          },
        ],
      },
    ] as any);
    render(
      <MemoryRouter>
        <IndexUpgradesPage />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: '生成升级预览' }));
    await screen.findByText('向量：激活结果待核实');
    expect(screen.getByText('图谱：失败')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '重试图谱' }));
    await waitFor(() =>
      expect(api.command).toHaveBeenCalledWith('plan', 'retry', '3'),
    );
    expect(screen.getByRole('button', { name: '仅重试失败项' })).toBeTruthy();
    expect(screen.getByText('当前三条索引均有效 0')).toBeTruthy();
  });
  it('normalizes unexpected errors instead of showing provider details', async () => {
    vi.mocked(api.preview).mockRejectedValue(
      new Error('private model response'),
    );
    render(
      <MemoryRouter>
        <IndexUpgradesPage />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: '生成升级预览' }));
    await screen.findByRole('alert');
    expect(document.body.textContent).not.toContain('private model');
  });
});
