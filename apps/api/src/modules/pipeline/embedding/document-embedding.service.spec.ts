import { describe, expect, it, vi } from 'vitest';
import { EmbeddingBatcher } from './embedding-batcher';
import { DocumentEmbeddingService } from './document-embedding.service';
describe('document vector reuse', () => {
  function fixture() {
    const provider = {
      fingerprint: 'revision1',
      dimensions: 2,
      validateInputs: vi.fn(),
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
    expect(provider.embedDocuments).toHaveBeenLastCalledWith(
      ['same'],
      expect.any(Function),
    );
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
  it('applies a lowered token limit before reusing any cached vector and writes no new cache after failure', async () => {
    const { provider, cache, service } = fixture();
    await service.embed('doc', ['same']);
    cache.find.mockClear();
    cache.save.mockClear();
    provider.validateInputs.mockImplementation(() => {
      throw new Error('token budget');
    });
    await expect(service.embed('doc', ['same'])).rejects.toThrow(
      'token budget',
    );
    expect(cache.find).not.toHaveBeenCalled();
    expect(cache.save).not.toHaveBeenCalled();
    expect(provider.embedDocuments).toHaveBeenCalledTimes(1);
  });
  it('persists successful batches before a later failure and reuses them after service recreation', async () => {
    const { provider, cache } = fixture();
    const calls: string[][] = [];
    let fail = true;
    const batcher = new EmbeddingBatcher(
      {
        embedDocuments: async (texts) => {
          calls.push(texts);
          if (fail && texts.includes('c'))
            throw new Error('third batch offline');
          return texts.map((text) => [text.charCodeAt(0), 1]);
        },
      },
      { dimensions: 2, batchSize: 1, maxCharacters: 100, concurrency: 1 },
    );
    provider.embedDocuments = vi.fn((texts, callback) =>
      batcher.embedDocuments(texts, callback),
    ) as any;
    const progress = vi.fn();
    await expect(
      new DocumentEmbeddingService(provider as any, cache as any).embed(
        'doc',
        ['a', 'b', 'a', 'c'],
        progress,
      ),
    ).rejects.toThrow('third batch');
    expect(cache.save).toHaveBeenCalledTimes(2);
    expect(progress.mock.calls).toEqual([
      [0, 4],
      [2, 4],
      [3, 4],
    ]);
    fail = false;
    const recovered = new DocumentEmbeddingService(
      provider as any,
      cache as any,
    );
    expect(
      await recovered.embed('doc', ['a', 'b', 'a', 'c'], progress),
    ).toEqual([
      [97, 1],
      [98, 1],
      [97, 1],
      [99, 1],
    ]);
    expect(calls).toEqual([['a'], ['b'], ['c'], ['c']]);
    expect(progress.mock.calls.slice(3)).toEqual([
      [3, 4],
      [4, 4],
    ]);
  });

  it.each([
    [['unknown'], [[1, 2]]],
    [
      ['same', 'same'],
      [
        [1, 2],
        [1, 2],
      ],
    ],
    [['same'], [[0, 0]]],
    [['same'], new Array(1)],
    [['same'], []],
    [undefined, undefined],
  ])(
    'rejects malformed completed callbacks without writing them (%j)',
    async (batch, vectors) => {
      const { provider, cache, service } = fixture();
      provider.embedDocuments.mockImplementationOnce(
        async (_texts, callback) => {
          await callback(batch, vectors);
          return [[1, 2]];
        },
      );
      await expect(service.embed('doc', ['same'])).rejects.toThrow(
        'Invalid completed',
      );
      expect(cache.save).not.toHaveBeenCalled();
    },
  );

  it('retries a failed checkpoint write at completion without recomputing vectors', async () => {
    const { provider, cache, service } = fixture();
    cache.save.mockRejectedValueOnce(new Error('temporary failure'));
    provider.embedDocuments.mockImplementationOnce(async (texts, callback) => {
      const vectors = texts.map(() => [1, 2]);
      await callback(texts, vectors);
      return vectors;
    });
    expect(await service.embed('doc', ['same'])).toEqual([[1, 2]]);
    expect(cache.save).toHaveBeenCalledTimes(2);
    await service.embed('doc', ['same']);
    expect(provider.embedDocuments).toHaveBeenCalledOnce();
  });
});
