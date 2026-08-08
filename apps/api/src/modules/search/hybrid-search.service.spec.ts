import { describe, expect, it, vi } from 'vitest';
import { HybridSearchService } from './hybrid-search.service';

describe('HybridSearchService', () => {
  it('merges keyword and semantic results with document-level deduplication', async () => {
    const searchQuery = {
      searchDocuments: vi.fn().mockResolvedValue({
        items: [
          {
            id: 'document-1',
            title: 'RabbitMQ Guide',
            category: 'platform',
            team: 'infra',
            tags: ['mq'],
            score: 10,
          },
          {
            id: 'document-2',
            title: 'Search Guide',
            category: 'platform',
            team: 'infra',
            tags: ['search'],
            score: 5,
          },
        ],
        page: 1,
        pageSize: 3,
        total: 2,
      }),
    };
    const ragQuery = {
      search: vi.fn().mockResolvedValue({
        query: 'how does retrieval work?',
        topK: 3,
        items: [
          {
            chunkId: 'document-1:v1:c0',
            documentId: 'document-1',
            documentVersion: 1,
            chunkIndex: 0,
            content: 'RabbitMQ content',
            score: 0.9,
            document: {
              title: 'RabbitMQ Guide',
              category: 'platform',
              team: 'infra',
              tags: ['mq'],
            },
          },
          {
            chunkId: 'document-3:v1:c0',
            documentId: 'document-3',
            documentVersion: 1,
            chunkIndex: 0,
            content: 'Semantic content',
            score: 0.8,
            document: {
              title: 'Semantic Guide',
              category: 'platform',
              team: 'infra',
              tags: ['rag'],
            },
          },
        ],
      }),
    };
    const service = new HybridSearchService(searchQuery as any, ragQuery as any);

    const result = await service.search({
      query: '  how does retrieval work? ',
      topK: 3,
    });

    expect(result.query).toBe('how does retrieval work?');
    expect(result.items.map((item) => item.documentId)).toEqual([
      'document-1',
      'document-3',
      'document-2',
    ]);
    expect(result.items[0]).toMatchObject({
      chunkId: 'document-1:v1:c0',
      sources: ['semantic', 'keyword'],
      keywordScore: 10,
      semanticScore: 0.9,
      score: 1,
    });
    expect(result.items[2]).toMatchObject({
      documentId: 'document-2',
      sources: ['keyword'],
    });
    expect(result.items[2].content).toBeUndefined();
    expect(searchQuery.searchDocuments).toHaveBeenCalledWith({
      keyword: 'how does retrieval work?',
      page: 1,
      pageSize: 3,
    });
    expect(ragQuery.search).toHaveBeenCalledWith({
      query: 'how does retrieval work?',
      topK: 3,
    });
  });
});
