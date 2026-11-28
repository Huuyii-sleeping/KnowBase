// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { documentFixture } from '@/test-fixtures/document';
import { httpError } from '@/lib/api-error';
import { EditContentDialog } from './edit-content-dialog';
import { EditMetaDialog } from './edit-meta-dialog';

const api = vi.hoisted(() => ({ update: vi.fn(), updateContent: vi.fn() }));
vi.mock('@/lib/api', () => ({ documentsApi: api }));
vi.mock('@/components/toast', () => ({ toast: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

for (const dialog of [
  {
    name: 'metadata',
    Component: EditMetaDialog,
    request: api.update,
    button: '保存',
    field: () => screen.getByLabelText('标题'),
  },
  {
    name: 'content',
    Component: EditContentDialog,
    request: api.updateContent,
    button: '保存为新版本',
    field: () => screen.getByRole('textbox'),
  },
]) {
  describe(`${dialog.name} save errors`, () => {
    it.each([
      httpError(400, { message: 'private validation' }),
      httpError(503, null),
      new Error('private stack'),
    ])(
      'keeps unsaved edits and never automatically resends a failed write (%s)',
      async (reason) => {
        dialog.request
          .mockRejectedValueOnce(reason)
          .mockResolvedValueOnce(documentFixture());
        const onOpenChange = vi.fn();
        const onSaved = vi.fn();
        render(
          <dialog.Component
            open
            doc={documentFixture()}
            onSaved={onSaved}
            onOpenChange={onOpenChange}
          />,
        );
        fireEvent.change(dialog.field(), { target: { value: 'Unsaved edit' } });
        fireEvent.click(screen.getByRole('button', { name: dialog.button }));
        expect((await screen.findByRole('alert')).textContent).not.toContain(
          'private',
        );
        expect((dialog.field() as HTMLInputElement).value).toBe('Unsaved edit');
        expect(onOpenChange).not.toHaveBeenCalled();
        expect(onSaved).not.toHaveBeenCalled();
        expect(dialog.request).toHaveBeenCalledOnce();
        expect(screen.queryByRole('button', { name: '重新尝试' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: dialog.button }));
        await vi.waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
        expect(onOpenChange).toHaveBeenCalledWith(false);
        expect(screen.queryByRole('alert')).toBeNull();
      },
    );
  });
}

it('normalizes local empty content validation without sending any request', async () => {
  render(
    <EditContentDialog
      open
      doc={documentFixture()}
      onSaved={vi.fn()}
      onOpenChange={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '  ' } });
  fireEvent.click(screen.getByRole('button', { name: '保存为新版本' }));
  expect((await screen.findByRole('alert')).textContent).toContain(
    '正文不能为空',
  );
  expect(api.updateContent).not.toHaveBeenCalled();
});
