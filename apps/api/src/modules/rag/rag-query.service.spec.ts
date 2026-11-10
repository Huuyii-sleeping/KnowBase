import { describe, expect, it, vi } from 'vitest';
import { RagQueryService } from './rag-query.service';

const user = { id: 'user', role: 'MEMBER' as const };
const current = {
  id: 'doc',
  version: 2,
  title: 'Title',
  category: null,
  team: null,
  tags: [],
};
const chunk = (id: string, documentId = 'doc', version = 2) => ({
  id,
  documentId,
  version,
  chunkIndex: 0,
  content: `body ${id}`,
  score: 7,
});
function fixture() {
  const embedding = { embedQuery: vi.fn().mockResolvedValue([0.9, 0.8]) };
  const index = {
    searchChunks: vi.fn().mockResolvedValue([chunk('current')]),
    searchKeywordChunks: vi.fn().mockResolvedValue([chunk('current')]),
  };
  const documents = {
    findVisiblePublishedIds: vi.fn().mockResolvedValue(['doc']),
    findPublishedByIds: vi.fn().mockResolvedValue([current]),
  };
  return {
    embedding,
    index,
    documents,
    service: new RagQueryService(
      embedding as any,
      index as any,
      documents as any,
    ),
  };
}

describe('RagQueryService', () => {
  it('rejects invalid queries, budgets and routes before any infrastructure work', async () => {
    const { service, embedding, documents } = fixture();
    for (const topK of [0, -1, 101, 1.5])
      await expect(
        service.recall({ query: '问题', topK }, 'semantic', user),
      ).rejects.toThrow('candidate budget');
    await expect(
      service.recall({ query: ' ', topK: 5 }, 'semantic', user),
    ).rejects.toThrow('non-empty');
    await expect(
      service.recall({ query: '问题', topK: 5 }, 'invalid' as any, user),
    ).rejects.toThrow('unsupported');
    expect(embedding.embedQuery).not.toHaveBeenCalled();
    expect(documents.findVisiblePublishedIds).not.toHaveBeenCalled();
  });

  it('does no embedding, index or hydration work when there are no visible documents', async () => {
    const { service, embedding, index, documents } = fixture();
    documents.findVisiblePublishedIds.mockResolvedValue([]);
    for (const route of ['keyword', 'semantic'] as const)
      expect(
        await service.recall({ query: '问题', topK: 5 }, route, user),
      ).toMatchObject({ items: [], rawCandidates: [] });
    expect(embedding.embedQuery).not.toHaveBeenCalled();
    expect(index.searchChunks).not.toHaveBeenCalled();
    expect(index.searchKeywordChunks).not.toHaveBeenCalled();
    expect(documents.findPublishedByIds).not.toHaveBeenCalled();
  });

  it('embeds normalized questions and preserves candidate order after one batch metadata read', async () => {
    const { service, embedding, index, documents } = fixture();
    index.searchChunks.mockResolvedValue([chunk('first'), chunk('second')]);
    const result = await service.search(
      { query: '  question ', topK: 2 },
      user,
    );
    expect(result.items.map((i) => i.chunkId)).toEqual(['first', 'second']);
    expect(result.items[0]).toMatchObject({
      documentId: 'doc',
      documentVersion: 2,
      content: 'body first',
      document: { title: 'Title' },
    });
    expect(embedding.embedQuery).toHaveBeenCalledWith('question');
    expect(index.searchChunks).toHaveBeenCalledWith({
      topK: 6,
      allowedDocumentIds: ['doc'],
      queryVector: [0.9, 0.8],
    });
    expect(documents.findPublishedByIds).toHaveBeenCalledTimes(1);
    expect(documents.findPublishedByIds).toHaveBeenCalledWith(
      ['doc', 'doc'],
      user,
    );
    expect(Object.keys(result).sort()).toEqual(['items', 'query', 'topK']);
  });

  it('keeps raw candidates internal and filters outdated, removed, draft and no-longer-visible documents', async () => {
    const { service, embedding, index, documents } = fixture();
    const raw = [
      chunk('old', 'doc', 1),
      chunk('missing', 'removed'),
      chunk('draft', 'draft'),
      chunk('hidden', 'hidden'),
      chunk('current'),
    ];
    index.searchKeywordChunks.mockResolvedValue(raw);
    const result = await service.recall(
      { query: ' evidence ', topK: 1 },
      'keyword',
      user,
    );
    expect(result.rawCandidates).toEqual(raw);
    expect(result.items.map((i) => i.chunkId)).toEqual(['current']);
    expect(documents.findPublishedByIds).toHaveBeenCalledWith(
      ['doc', 'removed', 'draft', 'hidden', 'doc'],
      user,
    );
    expect(index.searchKeywordChunks).toHaveBeenCalledWith({
      query: 'evidence',
      topK: 3,
      allowedDocumentIds: ['doc'],
    });
    expect(embedding.embedQuery).not.toHaveBeenCalled();
    for (const value of Object.values(result.timings))
      expect(value).toBeGreaterThanOrEqual(0);
    expect(
      Object.keys(
        await service.searchKeywordChunks({ query: 'evidence', topK: 1 }, user),
      ).sort(),
    ).toEqual(['items', 'query', 'topK']);
  });

  it('skips metadata for empty recall and propagates database failures instead of hiding them', async () => {
    const { service, index, documents } = fixture();
    index.searchKeywordChunks.mockResolvedValueOnce([]);
    expect(
      (await service.searchKeywordChunks({ query: 'none', topK: 1 })).items,
    ).toEqual([]);
    expect(documents.findPublishedByIds).not.toHaveBeenCalled();
    documents.findPublishedByIds.mockRejectedValueOnce(
      new Error('database unavailable'),
    );
    await expect(
      service.searchKeywordChunks({ query: 'evidence', topK: 1 }),
    ).rejects.toThrow('database unavailable');
  });

  it('fails on a missing query vector without querying the vector index', async () => {
    const { service, embedding, index } = fixture();
    embedding.embedQuery.mockResolvedValue([]);
    await expect(
      service.search({ query: 'question', topK: 5 }),
    ).rejects.toThrow('no query vector');
    expect(index.searchChunks).not.toHaveBeenCalled();
  });
});
