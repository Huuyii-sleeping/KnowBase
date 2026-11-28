import { describe, expect, it, vi } from 'vitest';
import { EmbeddingBatcher } from './embedding-batcher';

const options = {
  dimensions: 2,
  batchSize: 2,
  maxCharacters: 10,
  concurrency: 2,
};
describe('bounded embedding work', () => {
  it('deduplicates, preserves order and obeys a global concurrency limit across documents', async () => {
    let active = 0,
      peak = 0;
    const provider = {
      embedDocuments: vi.fn(async (texts: string[]) => {
        active++;
        peak = Math.max(active, peak);
        await new Promise((resolve) => setTimeout(resolve, 2));
        active--;
        return texts.map((text) => [text.length, 1]);
      }),
    };
    const service = new EmbeddingBatcher(provider, options);
    const [first, second] = await Promise.all([
      service.embedDocuments(['a', 'bb', 'a', 'ccc', 'dddd', 'eeeee']),
      service.embedDocuments(['x', 'yy', 'zzz', 'wwww']),
    ]);
    expect(first).toEqual([
      [1, 1],
      [2, 1],
      [1, 1],
      [3, 1],
      [4, 1],
      [5, 1],
    ]);
    expect(second).toHaveLength(4);
    expect(peak).toBe(2);
    const inputs = provider.embedDocuments.mock.calls.map(([texts]) => texts);
    expect(
      inputs.every((texts) => texts.length <= 2 && texts.join('').length <= 10),
    ).toBe(true);
    expect(inputs.flat().filter((text) => text === 'a')).toHaveLength(1);
  });
  it.each(
    [
      undefined,
      [],
      [[1]],
      [[NaN, 1]],
      [[Infinity, 1]],
      [[0, 0]],
      [[1e308, 1e308]],
      [['1', 1]],
    ].map((result) => ({ result })),
  )('rejects invalid provider output ($result)', async ({ result }) => {
    await expect(
      new EmbeddingBatcher(
        { embedDocuments: vi.fn().mockResolvedValue(result) },
        options,
      ).embedDocuments(['a']),
    ).rejects.toThrow('invalid');
  });
  it('rejects invalid inputs before calling the model, handles empty batches and releases permits on error', async () => {
    const provider = {
      embedDocuments: vi
        .fn()
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValue([[1, 2]]),
    };
    const service = new EmbeddingBatcher(provider, {
      ...options,
      concurrency: 1,
    });
    expect(await service.embedDocuments([])).toEqual([]);
    await expect(service.embedDocuments(['a'.repeat(11)])).rejects.toThrow(
      'exceeds',
    );
    await expect(service.embedDocuments([' '])).rejects.toThrow('empty');
    expect(provider.embedDocuments).not.toHaveBeenCalled();
    await expect(service.embedDocuments(['a'])).rejects.toThrow('offline');
    expect(await service.embedDocuments(['a'])).toEqual([[1, 2]]);
  });
  it('checkpoints only validated batches and awaits in-flight checkpoints before rejecting', async () => {
    let release!: () => void;
    const inFlight = new Promise<void>((resolve) => {
      release = resolve;
    });
    let began!: () => void;
    const started = new Promise<void>((resolve) => {
      began = resolve;
    });
    const checkpoint = vi.fn();
    const service = new EmbeddingBatcher(
      {
        embedDocuments: async (texts) => {
          if (texts[0] === 'a') {
            began();
            await inFlight;
            return [[1, 2]];
          }
          await started;
          release();
          return [[NaN, 1]];
        },
      },
      { ...options, batchSize: 1 },
    );
    await expect(
      service.embedDocuments(['a', 'b', 'c'], checkpoint),
    ).rejects.toThrow('invalid');
    expect(checkpoint).toHaveBeenCalledExactlyOnceWith(['a'], [[1, 2]]);
  });

  it('releases permits when a checkpoint fails', async () => {
    const service = new EmbeddingBatcher(
      { embedDocuments: async () => [[1, 2]] },
      { ...options, concurrency: 1 },
    );
    await expect(
      service.embedDocuments(['a'], async () => {
        throw new Error('checkpoint failed');
      }),
    ).rejects.toThrow('checkpoint failed');
    expect(await service.embedDocuments(['b'])).toEqual([[1, 2]]);
  });
});
