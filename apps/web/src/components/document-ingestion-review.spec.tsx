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
import { DocumentParseReview } from './document-parse-review';
import { DocumentEvidencePanel } from './document-evidence-panel';
vi.mock('@/lib/api', () => ({
  documentsApi: {
    draft: vi.fn(),
    reviewParse: vi.fn(),
    evidence: vi.fn(),
    resourceAccess: vi.fn(),
  },
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const doc = () =>
  ({
    ...documentFixture(),
    ingestion: {
      canManage: true,
      task: { id: 'task', hasDraft: true, state: 'needs_review' },
    },
  }) as any;
describe('parse review and evidence', () => {
  it('requires a review note and issue acknowledgment before adoption', async () => {
    vi.mocked(documentsApi.draft).mockResolvedValue({
      markdown: '候选正文',
      ready: false,
      quality: { issues: [{ code: 'MISSING', message: '缺少图像信息' }] },
    } as any);
    const refresh = vi.fn(async () => {});
    render(<DocumentParseReview document={doc()} onRefresh={refresh} />);
    fireEvent.click(screen.getByRole('button', { name: '核对解析草稿' }));
    await screen.findByText('候选正文');
    const accept = screen.getByRole('button', {
      name: '采用草稿，待提交审核',
    }) as HTMLButtonElement;
    expect(accept.disabled).toBe(true);
    fireEvent.change(screen.getByRole('textbox', { name: '核对说明' }), {
      target: { value: '已核对原件' },
    });
    expect(accept.disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(accept.disabled).toBe(false);
    fireEvent.click(accept);
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(documentsApi.reviewParse).toHaveBeenCalledWith(
      doc().id,
      'task',
      true,
      true,
      '已核对原件',
    );
  });
  it('keeps reviewers informed when draft loading fails and hides controls for readers', async () => {
    vi.mocked(documentsApi.draft).mockRejectedValue(
      new Error('internal secret'),
    );
    const document = doc();
    const { rerender } = render(
      <DocumentParseReview document={document} onRefresh={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: '核对解析草稿' }));
    await screen.findByRole('alert');
    expect(screen.queryByText('internal secret')).toBeNull();
    rerender(
      <DocumentParseReview
        document={{
          ...document,
          ingestion: { ...document.ingestion, canManage: false },
        }}
        onRefresh={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: '核对解析草稿' })).toBeNull();
  });
  it('loads evidence on demand, pages it, and includes the selected draft', async () => {
    vi.mocked(documentsApi.resourceAccess).mockResolvedValue({
      url: '/source?ticket=bound',
      expiresInSeconds: 300,
    });
    vi.mocked(documentsApi.evidence).mockResolvedValue({
      total: 21,
      items: [
        {
          id: 'row',
          kind: 'worksheet_row',
          source: { sheet: '预算', cellRange: 'A2:B2' },
          text: '研发 0',
          objectKeys: [],
          data: {
            cells: [
              {
                address: 'B2',
                value: 0,
                formula: '1-1',
                hasCachedResult: true,
                cachedResult: 0,
              },
            ],
          },
        },
      ],
    } as any);
    render(<DocumentEvidencePanel document={doc()} taskId="task" />);
    expect(documentsApi.evidence).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '查看原件与解析证据' }));
    await screen.findByText('研发 0');
    expect(documentsApi.evidence).toHaveBeenCalledWith(doc().id, 0, 'task');
    expect(screen.getByText('B2')).toBeDefined();
    expect(screen.getByText('1-1')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    await waitFor(() =>
      expect(documentsApi.evidence).toHaveBeenCalledWith(doc().id, 20, 'task'),
    );
  });
});
