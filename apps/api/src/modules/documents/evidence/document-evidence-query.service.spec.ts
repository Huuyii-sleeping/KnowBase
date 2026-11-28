import { describe, expect, it, vi } from 'vitest';
vi.mock('../entities/document.entity', () => ({ Document: class {} }));
import { DocumentEvidenceQueryService } from './document-evidence-query.service';
const fixture = () => {
  const documents = {
    findOneBy: vi.fn(async () => ({ contentId: 'adopted' })),
  };
  const access = { assertCanView: vi.fn() };
  const content = {
    findByContentId: vi.fn(async () => ({
      contentId: 'adopted',
      documentId: 'doc',
      evidenceManifest: { count: 3 },
    })),
  };
  const evidence = { page: vi.fn(async () => [{ id: 'row' }]) };
  const drafts = {
    read: vi.fn(async () => ({
      body: { contentId: 'draft', documentId: 'doc' },
    })),
  };
  return {
    documents,
    access,
    content,
    evidence,
    drafts,
    service: new DocumentEvidenceQueryService(
      documents as any,
      access as any,
      content as any,
      evidence as any,
      drafts as any,
    ),
  };
};
describe('evidence pagination access', () => {
  it('reads adopted evidence by default and checks draft permissions through its use case', async () => {
    const f = fixture();
    expect(await f.service.list('doc', {} as any, '1', '2')).toMatchObject({
      total: 3,
      offset: 1,
      limit: 2,
    });
    expect(f.evidence.page).toHaveBeenCalledWith('doc', 'adopted', 1, 2);
    const taskId = '00000000-0000-4000-8000-000000000001';
    await f.service.list('doc', {} as any, '0', '20', taskId);
    expect(f.drafts.read).toHaveBeenCalledWith('doc', taskId, {});
    expect(f.evidence.page).toHaveBeenLastCalledWith('doc', 'draft', 0, 20);
  });
  it('rejects invalid pagination, inaccessible documents and mismatched content before evidence reads', async () => {
    const f = fixture();
    for (const [offset, limit] of [
      ['-1', '20'],
      ['0', '101'],
      ['0', '0'],
      ['1.2', '20'],
    ])
      await expect(
        f.service.list('doc', {} as any, offset, limit),
      ).rejects.toThrow('pagination');
    await expect(
      f.service.list('doc', {} as any, '0', '20', 'invalid'),
    ).rejects.toThrow('task ID');
    f.access.assertCanView.mockImplementationOnce(() => {
      throw new Error('forbidden');
    });
    await expect(f.service.list('doc', {} as any)).rejects.toThrow('forbidden');
    f.content.findByContentId.mockResolvedValueOnce({
      documentId: 'other',
    } as any);
    await expect(f.service.list('doc', {} as any)).rejects.toThrow(
      'content missing',
    );
    expect(f.evidence.page).not.toHaveBeenCalled();
  });
});
