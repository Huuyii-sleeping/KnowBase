import { describe, expect, it, vi } from 'vitest';
import { DocumentEmbeddingService } from './document-embedding.service';
describe('document vector reuse', () => {
  function fixture() {
    const provider = {
      fingerprint: 'revision1',
      dimensions: 2,
      embedDocuments: vi.fn(async (texts) => texts.map(() => [1, 2])),
    };
    const records = new Map<string, number[]>();
    const cache = {
      find: vi.fn(
        async (keys: string[]) =>
          new Map(
            keys
              .filter((key) => records.has(key))
              .map((key) => [key, records.get(key)!]),
          ),
      ),
      save: vi.fn(async (_documentId, entries) => {
        for (const entry of entries) records.set(entry.key, entry.vector);
      }),
    };
    return {
      provider,
      cache,
      service: new DocumentEmbeddingService(provider as any, cache as any),
    };
  }
  it('reuses only identical inputs in the same document and model revision', async () => {
    const { provider, service } = fixture();
    expect(await service.embed('doc', ['same', 'same'])).toEqual([
      [1, 2],
      [1, 2],
    ]);
    expect(provider.embedDocuments).toHaveBeenLastCalledWith(['same']);
    await service.embed('doc', ['same']);
    expect(provider.embedDocuments).toHaveBeenCalledTimes(1);
    await service.embed('other', ['same']);
    await service.embed('doc', ['changed']);
    provider.fingerprint = 'revision2';
    await service.embed('doc', ['same']);
    expect(provider.embedDocuments).toHaveBeenCalledTimes(4);
  });
  it('disables durable reuse without a revision and tolerates unavailable caches', async () => {
    const { provider, cache, service } = fixture();
    cache.find.mockRejectedValue(new Error('offline'));
    cache.save.mockRejectedValue(new Error('offline'));
    expect(await service.embed('doc', ['same'])).toEqual([[1, 2]]);
    provider.fingerprint = undefined as any;
    cache.find.mockClear();
    await service.embed('doc', ['same']);
    expect(cache.find).not.toHaveBeenCalled();
  });
  it('never caches invalid model responses and recalculates malformed cached vectors', async () => {
    const { provider, cache, service } = fixture();
    cache.find.mockImplementation(
      async (keys) => new Map(keys.map((key) => [key, [NaN, 1]])),
    );
    provider.embedDocuments.mockResolvedValueOnce([[0, 0]]);
    await expect(service.embed('doc', ['same'])).rejects.toThrow(
      'Invalid embedding',
    );
    expect(cache.save).not.toHaveBeenCalled();
  });
});
