import { describe, expect, it, vi } from 'vitest';
vi.mock('./entities/document.entity', () => ({
  Document: class {},
  DocumentStatus: { PUBLISHED: 'PUBLISHED' },
}));
import { DocumentSourceCleanupService } from './document-source-cleanup.service';
describe('DocumentSourceCleanupService', () => {
  it('retains asset references when storage cleanup fails and resumes safely', async () => {
    const content = {
      assetKeys: vi.fn().mockResolvedValue(['assets/doc/a']),
      deleteByDocumentId: vi.fn(),
    };
    const assets = {
      cleanup: vi
        .fn()
        .mockRejectedValueOnce(new Error('storage offline'))
        .mockResolvedValue(undefined),
    };
    const chunks = { deleteDocument: vi.fn() };
    const embeddings = { deleteDocument: vi.fn() };
    const storage = { removeObject: vi.fn() };
    const service = new DocumentSourceCleanupService(
      content as any,
      storage as any,
      { isDeleted: vi.fn().mockResolvedValue(true) } as any,
      chunks as any,
      embeddings as any,
      assets as any,
    );
    await expect(service.cleanup('doc', 'original')).rejects.toThrow(
      'storage offline',
    );
    expect(content.deleteByDocumentId).not.toHaveBeenCalled();
    await service.cleanup('doc', 'original');
    expect(assets.cleanup).toHaveBeenCalledTimes(2);
    expect(chunks.deleteDocument).toHaveBeenCalledWith('doc');
    expect(embeddings.deleteDocument).toHaveBeenCalledWith('doc');
    expect(content.deleteByDocumentId).toHaveBeenCalledWith('doc');
    expect(storage.removeObject).toHaveBeenCalledWith('original');
  });

  it('requires a committed deletion fence before removing sources', async () => {
    const content = {
      deleteByDocumentId: vi.fn(),
      assetKeys: vi.fn().mockResolvedValue([]),
    };
    const storage = { removeObject: vi.fn() };
    const generations = {
      isDeleted: vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true),
    };
    const service = new DocumentSourceCleanupService(
      content as any,
      storage as any,
      generations as any,
      { deleteDocument: vi.fn() } as any,
      { deleteDocument: vi.fn() } as any,
      { cleanup: vi.fn() } as any,
    );
    await service.cleanup('doc', 'key');
    expect(content.deleteByDocumentId).not.toHaveBeenCalled();
    await service.cleanup('doc', 'key');
    expect(storage.removeObject).toHaveBeenCalledWith('key');
    storage.removeObject.mockRejectedValueOnce(new Error('storage down'));
    await expect(service.cleanup('doc', 'key')).rejects.toThrow('storage down');
  });
});
