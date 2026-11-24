// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { documentsApi } from '@/lib/api';
import { createApiError } from '@/lib/api-error';
import { WebImportDialog } from './web-import-dialog';
vi.mock('@/lib/api', () => ({ documentsApi: { importWeb: vi.fn() } }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it('imports a snapshot once and links its parsing progress', async () => {
  vi.mocked(documentsApi.importWeb).mockResolvedValue({ id: 'saved' });
  const created = vi.fn();
  render(
    <MemoryRouter>
      <WebImportDialog open onOpenChange={vi.fn()} onCreated={created} />
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByRole('textbox', { name: '网页地址' }), {
    target: { value: 'https://example.com/article' },
  });
  fireEvent.click(screen.getByRole('button', { name: '保存并解析' }));
  expect(
    (await screen.findByRole('link', { name: '查看解析进度' })).getAttribute(
      'href',
    ),
  ).toBe('/documents/saved');
  expect(created).toHaveBeenCalledOnce();
  expect(documentsApi.importWeb).toHaveBeenCalledWith(
    'https://example.com/article',
  );
});
it('blocks resubmission when a write outcome is uncertain', async () => {
  vi.mocked(documentsApi.importWeb).mockRejectedValue(
    createApiError('REQUEST_INTERRUPTED', { kind: 'network' }),
  );
  render(
    <MemoryRouter>
      <WebImportDialog open onOpenChange={vi.fn()} onCreated={vi.fn()} />
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByRole('textbox', { name: '网页地址' }), {
    target: { value: 'https://example.com/article' },
  });
  fireEvent.click(screen.getByRole('button', { name: '保存并解析' }));
  await screen.findByRole('alert');
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: '保存并解析' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true),
  );
  expect(
    screen.getByRole('link', { name: '查看文档库确认结果' }),
  ).toBeDefined();
  expect(documentsApi.importWeb).toHaveBeenCalledOnce();
});
