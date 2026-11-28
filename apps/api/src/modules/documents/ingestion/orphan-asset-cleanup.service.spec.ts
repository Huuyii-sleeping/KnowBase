import { describe, expect, it, vi } from 'vitest';
import { OrphanAssetCleanupService } from './orphan-asset-cleanup.service';
describe('orphan asset ownership cleanup', () => {
  it('preserves adopted history and running/draft work, removes unreferenced old resources', async () => {
    const storage = {
      orphanCandidates: vi.fn(async () => [
        { objectKey: 'adopted', documentId: 'd1' },
        { objectKey: 'working', documentId: 'd2' },
        { objectKey: 'orphan', documentId: 'd3' },
      ]),
      removeObject: vi.fn(),
    };
    const content = {
      referencesAsset: vi.fn(async (key) => key === 'adopted'),
    };
    const source = {
      query: vi.fn(async (_sql, [id]) => (id === 'd2' ? [{}] : [])),
    };
    const service = new OrphanAssetCleanupService(
      storage as any,
      content as any,
      source as any,
    );
    await service.run();
    expect(storage.removeObject).toHaveBeenCalledExactlyOnceWith('orphan');
    await service.run();
    expect(storage.orphanCandidates).toHaveBeenLastCalledWith('orphan');
  });
  it('propagates storage failures and leaves registry cleanup for retry', async () => {
    const storage = {
      orphanCandidates: vi.fn(async () => [
        { objectKey: 'orphan', documentId: 'doc' },
      ]),
      removeObject: vi.fn(async () => {
        throw new Error('storage down');
      }),
    };
    await expect(
      new OrphanAssetCleanupService(
        storage as any,
        { referencesAsset: async () => false } as any,
        { query: async () => [] } as any,
      ).run(),
    ).rejects.toThrow('storage down');
  });
});
