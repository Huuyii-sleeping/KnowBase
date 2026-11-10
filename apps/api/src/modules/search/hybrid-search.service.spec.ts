import { describe, expect, it, vi } from 'vitest';
import { HybridSearchService } from './hybrid-search.service';
import { RerankService } from '../retrieval/rerank/rerank.service';

const chunk = (chunkId: string, score: number) => ({
  chunkId,
  documentId: chunkId,
  documentVersion: 1,
  chunkIndex: 0,
  content: '正文证据',
  score,
  document: { title: 'Title', category: null, team: null, tags: [] },
});

describe('HybridSearchService', () => {
  it('passes the same identity to both chunk routes and selects the final budget after merging', async () => {
    const ragQuery = {
      searchKeywordChunks: vi
        .fn()
        .mockResolvedValue({ items: [chunk('a', 10), chunk('b', 5)] }),
      search: vi
        .fn()
        .mockResolvedValue({ items: [chunk('a', 0.9), chunk('c', 0.8)] }),
    };
    const service = new HybridSearchService(
      ragQuery as any,
      new RerankService(),
    );
    const user = { id: 'user', role: 'MEMBER' as const, team: 'team' };
    const result = await service.search({ query: '  证据  ', topK: 2 }, user);
    expect(result).toMatchObject({ query: '证据', topK: 2 });
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({
      chunkId: 'a',
      content: '正文证据',
      sources: ['keyword', 'semantic'],
    });
    for (const route of [ragQuery.search, ragQuery.searchKeywordChunks]) {
      expect(route).toHaveBeenCalledWith({ query: '证据', topK: 6 }, user);
    }
  });

  it('keeps usable keyword-only bodies when semantic retrieval returns no candidates', async () => {
    const service = new HybridSearchService(
      {
        searchKeywordChunks: vi
          .fn()
          .mockResolvedValue({ items: [chunk('a', 10)] }),
        search: vi.fn().mockResolvedValue({ items: [] }),
      } as any,
      new RerankService(),
    );
    expect(
      (await service.search({ query: '证据', topK: 1 })).items[0],
    ).toMatchObject({ content: '正文证据', sources: ['keyword'] });
  });

  it('bounds expanded route budgets even at the largest public TopK', async () => {
    const ragQuery = {
      searchKeywordChunks: vi.fn().mockResolvedValue({ items: [] }),
      search: vi.fn().mockResolvedValue({ items: [] }),
    };
    const result = await new HybridSearchService(
      ragQuery as any,
      new RerankService(),
    ).search({ query: '证据', topK: 20 });
    expect(result).toEqual({ query: '证据', topK: 20, items: [] });
    for (const route of [ragQuery.search, ragQuery.searchKeywordChunks]) {
      expect(route).toHaveBeenCalledWith(
        { query: '证据', topK: 60 },
        undefined,
      );
    }
  });

  it('surfaces route failures and does not return unvalidated fallback metadata', async () => {
    const service = new HybridSearchService(
      {
        searchKeywordChunks: vi
          .fn()
          .mockRejectedValue(new Error('index unavailable')),
        search: vi.fn().mockResolvedValue({ items: [] }),
      } as any,
      new RerankService(),
    );
    await expect(service.search({ query: '证据', topK: 1 })).rejects.toThrow(
      'index unavailable',
    );
  });
});
