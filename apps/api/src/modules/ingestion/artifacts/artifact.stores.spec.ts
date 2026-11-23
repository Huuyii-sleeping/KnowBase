import { describe, expect, it, vi } from 'vitest';
import { ChunkArtifactStore } from './chunk-artifact.store';
import { EmbeddingCacheStore } from './embedding-cache.store';

const config = { get: (_key: string, fallback: unknown) => fallback } as any;
function fixture() {
  const records: any[] = [];
  const query = {
    sort: vi.fn().mockReturnThis(),
    lean: vi.fn().mockReturnThis(),
    exec: vi.fn(async () => [...records].sort((a, b) => a.index - b.index)),
  };
  const model = {
    find: vi.fn((_filter: unknown) => query),
    bulkWrite: vi.fn(async (operations) => {
      for (const op of operations) records.push(op.updateOne.update.$set);
    }),
    updateOne: vi.fn(async (_filter, update) => {
      records.push(update.$set);
    }),
    deleteMany: vi.fn(),
  };
  return { model, records, query };
}
describe('artifact persistence', () => {
  it('requires a last-written manifest and digest before reusing ordered chunks', async () => {
    const { model, records } = fixture();
    const store = new ChunkArtifactStore(model as any, config);
    const chunks = [
      {
        content: '正文',
        contentHash: 'hash',
        headingPath: ['title'],
        ranges: [{ start: 0, end: 2 }],
        strategy: 'v1',
        embeddingText: '正文',
      },
    ];
    expect(await store.find('key')).toBeUndefined();
    await store.save('doc', 'key', chunks);
    expect(model.updateOne.mock.invocationCallOrder[0]).toBeGreaterThan(
      model.bulkWrite.mock.invocationCallOrder[0],
    );
    expect(await store.find('key')).toEqual(chunks);
    records[0].chunk = { ...chunks[0], content: 'corrupt' };
    expect(await store.find('key')).toBeUndefined();
    await store.deleteDocument('doc');
    expect(model.deleteMany).toHaveBeenCalledWith({ documentId: 'doc' });
  });
  it('does not publish a manifest after a partial storage failure; empty artifacts can be complete', async () => {
    const { model } = fixture();
    const store = new ChunkArtifactStore(model as any, config);
    model.bulkWrite.mockRejectedValueOnce(new Error('write failed'));
    await expect(store.save('doc', 'key', [{} as any])).rejects.toThrow(
      'write failed',
    );
    expect(model.updateOne).not.toHaveBeenCalled();
    await store.save('doc', 'empty', []);
    expect(await store.find('empty')).toEqual([]);
  });
  it('bounds cache requests, ignores expired entries via its query and persists a retention date', async () => {
    const { model } = fixture();
    const store = new EmbeddingCacheStore(model as any, config);
    const keys = Array.from({ length: 401 }, (_, i) => String(i));
    await store.find(keys);
    expect(model.find).toHaveBeenCalledTimes(3);
    expect(model.find.mock.calls[0][0]).toMatchObject({
      expiresAt: { $gt: expect.any(Date) },
    });
    await store.save(
      'doc',
      keys.map((key) => ({ key, vector: [1, 2] })),
    );
    expect(model.bulkWrite).toHaveBeenCalledTimes(3);
    expect(
      model.bulkWrite.mock.calls[0][0][0].updateOne.update.$set,
    ).toMatchObject({ documentId: 'doc', expiresAt: expect.any(Date) });
    await store.deleteDocument('doc');
    expect(model.deleteMany).toHaveBeenCalledWith({ documentId: 'doc' });
  });
});
