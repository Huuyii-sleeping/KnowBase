// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { documentsApi } from '@/lib/api';
import { documentFixture } from '@/test-fixtures/document';
import { DocumentParseProgress } from './document-parse-progress';

vi.mock('@/lib/api', () => ({
  documentsApi: { reparse: vi.fn(), cancelParse: vi.fn() },
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('Document parsing progress', () => {
  it('offers retry and reloads persisted state after submission', async () => {
    const refresh = vi.fn();
    render(
      <DocumentParseProgress
        document={{
          ...documentFixture(),
          ingestion: { canManage: true, task: null },
        }}
        onRefresh={refresh}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '从原文件重新解析' }));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(documentsApi.reparse).toHaveBeenCalledOnce();
  });
  it('offers cancellation for active work and hides mutation controls from readers', async () => {
    const document = {
      ...documentFixture(),
      ingestion: {
        canManage: true,
        task: {
          state: 'running',
          stage: 'parsing',
          attempts: 1,
          updatedAt: '',
        },
      },
    };
    const refresh = vi.fn();
    const view = render(
      <DocumentParseProgress document={document} onRefresh={refresh} />,
    );
    expect(screen.getByText('识别文档')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '取消解析' }));
    await waitFor(() =>
      expect(documentsApi.cancelParse).toHaveBeenCalledOnce(),
    );
    view.rerender(
      <DocumentParseProgress
        document={{
          ...document,
          ingestion: { ...document.ingestion, canManage: false },
        }}
        onRefresh={refresh}
      />,
    );
    expect(screen.queryByRole('button')).toBeNull();
  });
  it('shows normalized failures without rendering provider messages', async () => {
    vi.mocked(documentsApi.reparse).mockRejectedValue(
      new Error('private parser secret'),
    );
    render(
      <DocumentParseProgress
        document={{
          ...documentFixture(),
          ingestion: { canManage: true, task: null },
        }}
        onRefresh={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '从原文件重新解析' }));
    await screen.findByRole('alert');
    expect(document.body.textContent).not.toContain('private parser');
  });
});
