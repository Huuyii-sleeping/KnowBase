import { describe, expect, it, vi } from 'vitest';
import { DocumentChunksService } from './document-chunks.service';

describe('shared chunk artifacts', () => {
  function fixture() {
    const data = new Map<string, any>();
    const chunks = [{ content: 'body', contentHash: 'hash' }];
    const chunker = {
      strategy: 'v1',
      splitStructured: vi.fn().mockResolvedValue(chunks),
    };
    const store = {
      find: vi.fn(async (key) => data.get(key)),
      save: vi.fn(async (_documentId, key, value) => {
        data.set(key, value);
      }),
    };
    return {
      service: new DocumentChunksService(chunker as any, store as any),
      chunker,
      store,
      chunks,
    };
  }
  it('shares complete artifacts for the same content and invalidates changed content or strategy', async () => {
    const { service, chunker } = fixture();
    await service.forContent('doc', 'body', { markdown: 'hello' });
    await service.forContent('doc', 'body', { markdown: 'hello' });
    expect(chunker.splitStructured).toHaveBeenCalledTimes(1);
    await service.forContent('doc', 'body', { markdown: 'changed' });
    chunker.strategy = 'v2';
    await service.forContent('doc', 'body', { markdown: 'hello' });
    await service.forContent('other', 'body', { markdown: 'hello' });
    expect(chunker.splitStructured).toHaveBeenCalledTimes(4);
  });
  it('computes when persistence is unavailable but propagates invalid source without caching it', async () => {
    const { service, store, chunker, chunks } = fixture();
    store.find.mockRejectedValue(new Error('offline'));
    store.save.mockRejectedValue(new Error('offline'));
    expect(
      await service.forContent('doc', 'body', { markdown: 'hello' }),
    ).toEqual(chunks);
    store.save.mockClear();
    chunker.splitStructured.mockRejectedValue(new Error('bad table'));
    await expect(
      service.forContent('doc', 'body', { markdown: 'bad' }),
    ).rejects.toThrow('bad table');
    expect(store.save).not.toHaveBeenCalled();
  });
});
