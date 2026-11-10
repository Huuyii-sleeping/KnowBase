import { describe, expect, it, vi } from 'vitest';
vi.mock('./entities/document.entity', () => ({ Document: class {} }));
import { DocumentDeletionService } from './document-deletion.service';

function fixture() {
  const document = { id: 'doc', version: 3, storageKey: 'original/doc/a.md' };
  const manager = {
    findOne: vi.fn().mockResolvedValue(document),
    delete: vi.fn(),
  };
  const source = { transaction: vi.fn(async (work) => work(manager)) };
  const access = { assertCanEdit: vi.fn() };
  const generations = { tombstone: vi.fn() };
  const publisher = { deleteDocument: vi.fn() };
  return {
    service: new DocumentDeletionService(
      source as any,
      access as any,
      generations as any,
      publisher as any,
    ),
    manager,
    generations,
    publisher,
    access,
    document,
  };
}
describe('DocumentDeletionService', () => {
  it('locks, fences and enqueues cleanup in the same deletion transaction', async () => {
    const { service, generations, publisher, manager, document } = fixture();
    await service.remove('doc');
    expect(generations.tombstone).toHaveBeenCalledWith(manager, 'doc', 3);
    expect(publisher.deleteDocument).toHaveBeenCalledWith(document, manager);
    expect(manager.delete).toHaveBeenCalledWith(expect.anything(), 'doc');
  });
  it('does not delete metadata if durable cleanup cannot be created', async () => {
    const { service, publisher, manager } = fixture();
    publisher.deleteDocument.mockRejectedValueOnce(new Error('outbox failure'));
    await expect(service.remove('doc')).rejects.toThrow('outbox failure');
    expect(manager.delete).not.toHaveBeenCalled();
  });
  it('rejects unknown documents before tombstoning', async () => {
    const { service, manager, generations } = fixture();
    manager.findOne.mockResolvedValueOnce(null);
    await expect(service.remove('missing')).rejects.toThrow(
      'document not found',
    );
    expect(generations.tombstone).not.toHaveBeenCalled();
  });
});
