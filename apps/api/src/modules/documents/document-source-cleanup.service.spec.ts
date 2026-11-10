import { describe, expect, it, vi } from 'vitest';
vi.mock('./entities/document.entity', () => ({
  Document: class {},
  DocumentStatus: { PUBLISHED: 'PUBLISHED' },
}));
import { DocumentSourceCleanupService } from './document-source-cleanup.service';
describe('DocumentSourceCleanupService', () => {
  it('requires a committed deletion fence before removing sources', async () => {
    const content = { deleteByDocumentId: vi.fn() };
    const storage = { removeObject: vi.fn() };
    const generations = {
      isDeleted: vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true),
    };
    const service = new DocumentSourceCleanupService(
      content as any,
      storage as any,
      generations as any,
    );
    await service.cleanup('doc', 'key');
    expect(content.deleteByDocumentId).not.toHaveBeenCalled();
    await service.cleanup('doc', 'key');
    expect(storage.removeObject).toHaveBeenCalledWith('key');
    storage.removeObject.mockRejectedValueOnce(new Error('storage down'));
    await expect(service.cleanup('doc', 'key')).rejects.toThrow('storage down');
  });
});
