// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { createApiError, httpError } from '@/lib/api-error';
import { DocumentsPage } from './documents-page';
import { ReviewQueuePage } from './review-queue-page';
import { SearchPage } from './search-page';
import { GraphPage } from './graph-page';
import { LoginPage } from './login-page';
import { documentFixture } from '@/test-fixtures/document';
import { ToastHost } from '@/components/toast';
import { AskPage } from './ask-page';

const api = vi.hoisted(() => ({
  documentsApi: { list: vi.fn(), review: vi.fn() },
  searchApi: { documents: vi.fn(), semantic: vi.fn(), hybrid: vi.fn() },
  graphApi: { search: vi.fn() },
  authApi: { login: vi.fn() },
  answerApi: { answer: vi.fn() },
}));
vi.mock('@/lib/api', () => api);
vi.mock('@/lib/mock-api', () => ({ isMockEnabled: () => false }));
vi.mock('@/components/knowledge-graph-diagram', () => ({
  KnowledgeGraphDiagram: () => <div>关系画布</div>,
}));

const empty = { items: [], total: 0, page: 1, pageSize: 20 };
const cases = [
  {
    name: 'documents',
    ui: <DocumentsPage />,
    url: '/documents',
    request: api.documentsApi.list,
    emptyText: '从第一份文档开始',
  },
  {
    name: 'reviews',
    ui: <ReviewQueuePage />,
    url: '/review',
    request: api.documentsApi.list,
    emptyText: '所有审核已处理',
  },
  {
    name: 'graph',
    ui: <GraphPage />,
    url: '/graph?q=RAG&maxHops=3&limit=20',
    request: api.graphApi.search,
    emptyText: '没有找到图谱路径',
  },
  ...(['keyword', 'semantic', 'hybrid'] as const).map((mode) => ({
    name: `search-${mode}`,
    ui: <SearchPage />,
    url: `/search?q=RAG&mode=${mode}`,
    request: mode === 'keyword' ? api.searchApi.documents : api.searchApi[mode],
    emptyText: '没有找到匹配结果',
  })),
];

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

for (const page of cases) {
  describe(`${page.name} errors`, () => {
    function open() {
      render(
        <MemoryRouter initialEntries={[page.url]}>{page.ui}</MemoryRouter>,
      );
    }

    it('keeps the normal empty result distinct from a failure', async () => {
      page.request.mockResolvedValue(empty);
      open();
      await screen.findByText(page.emptyText);
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it.each([
      [httpError(401, null), 'login'],
      [httpError(403, null), 'contact_admin'],
      [httpError(400, { message: 'private raw validation' }), 'edit_input'],
      [httpError(500, { message: 'private database host' }), 'retry'],
      [new Error('private client stack'), 'retry'],
    ] as const)(
      'normalizes failures and uses the correct recovery action: %s',
      async (error, action) => {
        page.request.mockRejectedValue(error);
        open();
        const alert = await screen.findByRole('alert');
        expect(alert.textContent).not.toContain('private');
        expect(!!screen.queryByRole('button', { name: '重新尝试' })).toBe(
          action === 'retry',
        );
        expect(!!screen.queryByRole('link', { name: '重新登录' })).toBe(
          action === 'login',
        );
        expect(screen.queryByText(page.emptyText)).toBeNull();
        expect(page.request).toHaveBeenCalledOnce();
      },
    );

    it('retries only on click, then clears the failure on success', async () => {
      page.request
        .mockRejectedValueOnce(createApiError('NETWORK_ERROR'))
        .mockResolvedValueOnce(empty);
      open();
      await screen.findByRole('alert');
      expect(page.request).toHaveBeenCalledOnce();
      fireEvent.click(screen.getByRole('button', { name: '重新尝试' }));
      await screen.findByText(page.emptyText);
      expect(screen.queryByRole('alert')).toBeNull();
      expect(page.request).toHaveBeenCalledTimes(2);
      expect(page.request.mock.calls[1]).toEqual(page.request.mock.calls[0]);
    });
  });
}

describe('query retries', () => {
  it.each([
    {
      ui: <GraphPage />,
      url: '/graph?q=RAG&maxHops=3&limit=20',
      label: '图谱查询',
      request: api.graphApi.search,
      args: ['RAG', 3, 20],
    },
    {
      ui: <SearchPage />,
      url: '/search?q=RAG&mode=semantic',
      label: '检索问题',
      request: api.searchApi.semantic,
      args: ['RAG', 5],
    },
  ])(
    'retains failed parameters and preserves the new input draft: $label',
    async (page) => {
      page.request
        .mockRejectedValueOnce(httpError(503, null))
        .mockResolvedValueOnce(empty);
      render(
        <MemoryRouter initialEntries={[page.url]}>{page.ui}</MemoryRouter>,
      );
      await screen.findByRole('alert');
      fireEvent.change(screen.getByLabelText(page.label), {
        target: { value: 'New draft' },
      });
      fireEvent.click(screen.getByRole('button', { name: '重新尝试' }));
      await screen.findByText(/没有找到/);
      expect(page.request.mock.calls[1]).toEqual(page.args);
      expect(
        (screen.getByLabelText(page.label) as HTMLInputElement).value,
      ).toBe('New draft');
    },
  );
});

function ClearQuery({ url }: { url: string }) {
  const navigate = useNavigate();
  return <button onClick={() => navigate(url)}>清空查询</button>;
}

it.each([
  {
    ui: <GraphPage />,
    url: '/graph',
    request: api.graphApi.search,
    initialText: '每个知识点，都有它的连接',
  },
  {
    ui: <SearchPage />,
    url: '/search',
    request: api.searchApi.hybrid,
    initialText: '从一个关键词，找到更多',
  },
])('ignores a late failure after clearing $url', async (page) => {
  let reject!: (reason: unknown) => void;
  page.request.mockImplementation(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  render(
    <MemoryRouter initialEntries={[`${page.url}?q=RAG`]}>
      {page.ui}
      <ClearQuery url={page.url} />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole('button', { name: '清空查询' }));
  await screen.findByText(page.initialText);
  await act(async () => reject(new Error('private late error')));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(document.body.textContent).not.toContain('private');
});

describe('login failures', () => {
  it('keeps credentials, hides raw errors, and retries network errors only on click', async () => {
    api.authApi.login.mockRejectedValue(new Error('private host'));
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText('用户名'), {
      target: { value: 'tester' },
    });
    fireEvent.change(screen.getByLabelText('密码'), {
      target: { value: 'test-input' },
    });
    fireEvent.click(screen.getByRole('button', { name: '登录' }));
    expect((await screen.findByRole('alert')).textContent).not.toContain(
      'private',
    );
    expect(api.authApi.login).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '重新尝试' }));
    await screen.findByRole('alert');
    expect(api.authApi.login).toHaveBeenCalledTimes(2);
    expect(api.authApi.login).toHaveBeenLastCalledWith('tester', 'test-input');
  });

  it('keeps native required-field validation when retrying login', async () => {
    api.authApi.login.mockRejectedValue(httpError(503, null));
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: '登录' }));
    await screen.findByRole('alert');
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '重新尝试' }));
    expect(api.authApi.login).toHaveBeenCalledOnce();
    expect(
      (screen.getByLabelText('密码') as HTMLInputElement).validity.valueMissing,
    ).toBe(true);
  });

  it('asks for corrected credentials without offering request retry', async () => {
    api.authApi.login.mockRejectedValue(httpError(401, null, true));
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: '登录' }));
    expect((await screen.findByRole('alert')).textContent).toContain(
      '账号或密码不正确',
    );
    expect(screen.queryByRole('button', { name: '重新尝试' })).toBeNull();
  });
});

describe('answer failures', () => {
  it('retries the same question without duplicating the user bubble or consuming a new draft', async () => {
    api.answerApi.answer
      .mockRejectedValueOnce(httpError(500, null))
      .mockResolvedValueOnce({
        answer: 'Recovered answer',
        citations: [],
        contexts: [],
      });
    render(
      <MemoryRouter>
        <AskPage />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText('向知识库提问'), {
      target: { value: 'Original question' },
    });
    fireEvent.submit(screen.getByLabelText('向知识库提问').closest('form')!);
    await screen.findByRole('alert');
    fireEvent.change(screen.getByLabelText('向知识库提问'), {
      target: { value: 'New draft' },
    });
    fireEvent.click(screen.getByRole('button', { name: '重新尝试' }));
    await screen.findByText('Recovered answer');
    expect(api.answerApi.answer).toHaveBeenLastCalledWith(
      'Original question',
      3,
    );
    expect(screen.getAllByText('Original question')).toHaveLength(1);
    expect(
      (screen.getByLabelText('向知识库提问') as HTMLTextAreaElement).value,
    ).toBe('New draft');
  });
});

describe('review write failures', () => {
  it.each(['approve', 'reject'] as const)(
    'normalizes %s errors without replaying the action',
    async (action) => {
      api.documentsApi.list.mockResolvedValue({
        ...empty,
        items: [documentFixture({ status: 'PENDING_REVIEW' })],
      });
      api.documentsApi.review.mockRejectedValue(
        new Error('private review stack'),
      );
      render(
        <MemoryRouter>
          <ReviewQueuePage />
          <ToastHost />
        </MemoryRouter>,
      );
      await screen.findByRole('link', { name: 'Uploaded document' });
      if (action === 'approve')
        fireEvent.click(screen.getByRole('button', { name: '通过' }));
      else {
        fireEvent.click(screen.getByRole('button', { name: '驳回' }));
        fireEvent.change(
          screen.getByPlaceholderText('请填写驳回原因，将展示给提交人'),
          { target: { value: 'Needs correction' } },
        );
        fireEvent.click(screen.getByRole('button', { name: '确认驳回' }));
      }
      await screen.findByText('暂时无法完成此操作，请稍后再试。');
      expect(document.body.textContent).not.toContain('private');
      expect(api.documentsApi.review).toHaveBeenCalledOnce();
      expect(screen.queryByRole('button', { name: '重新尝试' })).toBeNull();
      if (action === 'reject')
        expect(
          (
            screen.getByPlaceholderText(
              '请填写驳回原因，将展示给提交人',
            ) as HTMLTextAreaElement
          ).value,
        ).toBe('Needs correction');
    },
  );
});
