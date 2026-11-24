// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { documentsApi, type DocumentDetail } from '@/lib/api';
import { documentFixture } from '@/test-fixtures/document';
import { httpError } from '@/lib/api-error';
import { DocumentDetailPage } from './document-detail-page';

vi.mock('@/lib/api', () => ({ documentsApi: { detail: vi.fn() } }));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function openDocument() {
  render(
    <MemoryRouter initialEntries={['/documents/saved']}>
      <Routes>
        <Route path="/documents/:id" element={<DocumentDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function savedDocument(
  parseStatus: DocumentDetail['parseStatus'],
): DocumentDetail {
  const document = documentFixture({
    parseStatus,
    parseError: 'private parser host and secret',
  });
  return {
    ...document,
    content: {
      ...document.content!,
      markdown:
        parseStatus === 'READY' ? 'Parsed body' : 'private parser output',
    },
  };
}

describe('document detail parsing state', () => {
  it.each(['FAILED', 'PENDING'] as const)(
    'keeps %s drafts out of review and hides failed parser details',
    async (status) => {
      vi.mocked(documentsApi.detail).mockResolvedValue(savedDocument(status));
      openDocument();
      await screen.findByRole('heading', { name: /Uploaded document/ });
      expect(
        (screen.getByRole('button', { name: '提交审核' }) as HTMLButtonElement)
          .disabled,
      ).toBe(true);
      expect(document.body.textContent).not.toContain('private parser');
      expect(document.body.textContent).toContain(
        status === 'FAILED' ? '文件已保存，但正文解析失败' : '文档正在解析中',
      );
    },
  );

  it('shows ready content and enables submission', async () => {
    vi.mocked(documentsApi.detail).mockResolvedValue(savedDocument('READY'));
    openDocument();
    await screen.findByText('Parsed body');
    expect(
      (screen.getByRole('button', { name: '提交审核' }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it('normalizes unexpected exceptions instead of rendering their raw message', async () => {
    vi.mocked(documentsApi.detail).mockRejectedValue(
      new Error('private stack'),
    );
    openDocument();
    await screen.findByText('暂时无法完成此操作，请稍后再试。');
    expect(document.body.textContent).not.toContain('private stack');
  });

  it('offers read retry for temporary failures and clears the notice on success', async () => {
    vi.mocked(documentsApi.detail)
      .mockRejectedValueOnce(httpError(503, null))
      .mockResolvedValueOnce(savedDocument('READY'));
    openDocument();
    await screen.findByRole('alert');
    expect(documentsApi.detail).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '重新尝试' }));
    await screen.findByText('Parsed body');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('requires login rather than retry when the session expires', async () => {
    vi.mocked(documentsApi.detail).mockRejectedValue(httpError(401, null));
    openDocument();
    expect(
      (await screen.findByRole('link', { name: '重新登录' })).getAttribute(
        'href',
      ),
    ).toBe('/login');
    expect(screen.queryByRole('button', { name: '重新尝试' })).toBeNull();
  });
});

it('shows the review state for a saved initial candidate instead of a parser failure', async () => {
  const candidate = savedDocument('FAILED');
  candidate.content = undefined;
  candidate.ingestion = {
    canManage: true,
    task: {
      id: 'task',
      state: 'needs_review',
      stage: 'needs_review',
      attempts: 1,
      updatedAt: '2026-11-23T00:00:00Z',
      hasDraft: true,
    },
  };
  vi.mocked(documentsApi.detail).mockResolvedValue(candidate);
  openDocument();
  await screen.findByText(
    '解析结果已保存为独立草稿，完成核对并采用后即可提交审核。',
  );
  expect(screen.getByRole('button', { name: '核对解析草稿' })).toBeDefined();
});
