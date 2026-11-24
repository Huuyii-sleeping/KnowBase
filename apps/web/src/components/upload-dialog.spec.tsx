// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { documentsApi, type DocumentDetail } from '@/lib/api';
import { createApiError, httpError } from '@/lib/api-error';
import { UploadDialog } from './upload-dialog';

vi.mock('@/lib/api', () => ({ documentsApi: { create: vi.fn() } }));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function setup() {
  const onCreated = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <MemoryRouter>
      <UploadDialog open onCreated={onCreated} onOpenChange={onOpenChange} />
    </MemoryRouter>,
  );
  return { onCreated, onOpenChange };
}

function pick(name = 'notes.txt', contents = 'hello') {
  fireEvent.change(screen.getByLabelText('选择文档文件'), {
    target: { files: [new File([contents], name)] },
  });
}

function upload() {
  fireEvent.click(screen.getByRole('button', { name: '保存为草稿' }));
}

describe('upload dialog', () => {
  it.each([
    ['READY', '上传成功，正文已就绪'],
    ['PENDING', '上传成功，正文尚未就绪'],
    ['FAILED', '文件已保存，正文解析失败'],
  ] as const)(
    'reports saved document and %s parsing outcome separately',
    async (parseStatus, title) => {
      vi.mocked(documentsApi.create).mockResolvedValue({
        id: 'saved-1',
        parseStatus,
        parseError: 'private parser host and stack',
      } as DocumentDetail);
      const { onCreated, onOpenChange } = setup();
      pick();
      upload();
      await screen.findByText(title);
      expect(
        screen.getByRole('link', { name: '查看文档' }).getAttribute('href'),
      ).toBe('/documents/saved-1');
      expect(onCreated).toHaveBeenCalledOnce();
      expect(onOpenChange).not.toHaveBeenCalled();
      expect(screen.queryByRole('button', { name: '保存为草稿' })).toBeNull();
      expect(document.body.textContent).not.toContain('private parser');
      fireEvent.click(screen.getByRole('button', { name: '完成' }));
      expect(onOpenChange).toHaveBeenCalledWith(false);
    },
  );

  it('uses the same format rules for the picker and drag/drop, allowing corrected input', async () => {
    setup();
    const input = screen.getByLabelText('选择文档文件');
    expect(input.getAttribute('accept')).not.toMatch(/mp3/);
    expect(input.getAttribute('accept')).not.toMatch(/mp4/);
    pick('recording.mp3');
    expect(screen.getByRole('alert').textContent).toContain(
      '暂不支持这种文件格式',
    );
    expect(vi.mocked(documentsApi.create)).not.toHaveBeenCalled();
    const drop = screen.getByRole('button', { name: /拖放文件/ });
    fireEvent.drop(drop, {
      dataTransfer: { files: [new File(['audio'], 'recording.mp4')] },
    });
    expect(screen.getByRole('alert').textContent).toContain(
      '暂不支持这种文件格式',
    );
    fireEvent.drop(drop, {
      dataTransfer: { files: [new File(['# doc'], 'notes.MD')] },
    });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(
      (screen.getByRole('button', { name: '保存为草稿' }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it('rejects empty and oversized files before sending a request', () => {
    setup();
    pick('empty.txt', '');
    expect(screen.getByRole('alert').textContent).toContain('文件内容为空');
    const large = new File(['test'], 'large.pdf');
    Object.defineProperty(large, 'size', { value: 100 * 1024 * 1024 + 1 });
    fireEvent.change(screen.getByLabelText('选择文档文件'), {
      target: { files: [large] },
    });
    expect(screen.getByRole('alert').textContent).toContain('不能超过 100 MB');
    expect(documentsApi.create).not.toHaveBeenCalled();
  });

  it('blocks repeated submission, dismiss and file replacement while upload is in progress', async () => {
    let resolve!: (document: DocumentDetail) => void;
    vi.mocked(documentsApi.create).mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const { onOpenChange } = setup();
    pick();
    upload();
    fireEvent.click(screen.getByRole('button', { name: '上传中…' }));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    pick('changed.txt');
    expect(documentsApi.create).toHaveBeenCalledOnce();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByText(/notes.txt ·/)).toBeDefined();
    resolve({ id: 'saved', parseStatus: 'READY' } as DocumentDetail);
    await screen.findByText('上传成功，正文已就绪');
  });

  it.each([
    createApiError('REQUEST_INTERRUPTED', { kind: 'timeout' }),
    createApiError('NETWORK_ERROR', { kind: 'network' }),
    createApiError('INVALID_RESPONSE', { kind: 'response', status: 201 }),
    httpError(500, null),
  ])(
    'offers verification and never automatically resends an ambiguous upload',
    async (error) => {
      vi.mocked(documentsApi.create).mockRejectedValue(error);
      const { onCreated } = setup();
      pick();
      upload();
      await screen.findByText('请先确认上传结果');
      expect(screen.getByRole('alert').textContent).toContain('文档可能已创建');
      expect(
        screen.getByRole('link', { name: '查看文档列表' }).getAttribute('href'),
      ).toBe('/documents');
      expect(screen.queryByRole('button', { name: '保存为草稿' })).toBeNull();
      expect(screen.queryByRole('button', { name: '重新尝试' })).toBeNull();
      expect(onCreated).toHaveBeenCalledOnce();
      await waitFor(() => expect(documentsApi.create).toHaveBeenCalledOnce());
    },
  );

  it('preserves inputs on a definite rejection and retries only on an explicit click', async () => {
    vi.mocked(documentsApi.create)
      .mockRejectedValueOnce(httpError(400, { code: 'FILE_UNSUPPORTED' }))
      .mockResolvedValueOnce({
        id: 'saved',
        parseStatus: 'READY',
      } as DocumentDetail);
    const { onCreated } = setup();
    pick();
    fireEvent.change(screen.getByLabelText('标题'), {
      target: { value: 'My title' },
    });
    upload();
    await screen.findByRole('alert');
    expect((screen.getByLabelText('标题') as HTMLInputElement).value).toBe(
      'My title',
    );
    expect(onCreated).not.toHaveBeenCalled();
    expect(documentsApi.create).toHaveBeenCalledOnce();
    upload();
    await screen.findByText('上传成功，正文已就绪');
    expect(documentsApi.create).toHaveBeenCalledTimes(2);
  });
});
