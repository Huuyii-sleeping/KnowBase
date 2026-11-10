import { describe, expect, it, vi } from 'vitest';
vi.mock('./entities/document.entity', () => ({
  Document: class {},
  DocumentStatus: { DRAFT: 'DRAFT' },
  DocumentParseStatus: { READY: 'READY' },
}));
import { DocumentRevisionService } from './document-revision.service';

function fixture() {
  let state: any = {
    id: 'doc',
    version: 2,
    contentId: 'old',
    title: 'Old',
    status: 'PUBLISHED',
    reviewedBy: 'admin',
  };
  let draft: any;
  const manager = { findOne: vi.fn(async () => draft), save: vi.fn() };
  const source = {
    transaction: async (work: any) => {
      draft = { ...state };
      await work(manager);
      state = draft;
    },
    getRepository: () => ({ findOneBy: vi.fn(async () => state) }),
  };
  const content = { create: vi.fn(), deleteByContentId: vi.fn() };
  const access = { assertCanEdit: vi.fn() };
  return {
    service: new DocumentRevisionService(
      source as any,
      content as any,
      access as any,
    ),
    manager,
    content,
    access,
    state: () => state,
  };
}
describe('DocumentRevisionService', () => {
  it('increments the revision for metadata changes and clears review state', async () => {
    const { service, state, manager } = fixture();
    await service.updateMetadata('doc', { title: 'New' });
    expect(state()).toMatchObject({
      version: 3,
      contentId: 'old',
      title: 'New',
      status: 'DRAFT',
      reviewedBy: null,
    });
    expect(manager.findOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
    );
  });
  it('does not create revisions for unchanged metadata', async () => {
    const { service, state, manager } = fixture();
    await service.updateMetadata('doc', { title: 'Old' });
    expect(state().version).toBe(2);
    expect(manager.save).not.toHaveBeenCalled();
  });
  it('writes a new immutable body and increments the locked document revision', async () => {
    const { service, state, content } = fixture();
    await service.updateContent('doc', { markdown: '# New' });
    expect(state()).toMatchObject({
      version: 3,
      status: 'DRAFT',
      parseStatus: 'READY',
    });
    expect(content.create).toHaveBeenCalledWith(
      expect.objectContaining({
        contentId: state().contentId,
        version: 3,
        markdown: '# New',
      }),
    );
  });
  it('removes a new body when metadata persistence rolls back', async () => {
    const { service, state, content, manager } = fixture();
    manager.save.mockRejectedValueOnce(new Error('database failure'));
    await expect(
      service.updateContent('doc', { markdown: '# New' }),
    ).rejects.toThrow('database failure');
    expect(state().contentId).toBe('old');
    expect(content.deleteByContentId).toHaveBeenCalledWith(
      content.create.mock.calls[0][0].contentId,
    );
  });
  it('rejects unauthorized edits before writing a body', async () => {
    const { service, content, access } = fixture();
    access.assertCanEdit.mockImplementationOnce(() => {
      throw new Error('forbidden');
    });
    await expect(
      service.updateContent('doc', { markdown: '# New' }, {
        id: 'member',
      } as any),
    ).rejects.toThrow('forbidden');
    expect(content.create).not.toHaveBeenCalled();
  });
});
