import { describe, expect, it } from 'vitest';
import { RerankService } from './rerank.service';

describe('RerankService', () => {
  it('combines scores, boosts dual-source matches, and limits document chunks', () => {
    const service = new RerankService();
    const result = service.rerank(
      'Elasticsearch port',
      [
        {
          documentId: 'document-1',
          chunkId: 'document-1:c0',
          title: 'Infrastructure Guide',
          content: 'Elasticsearch is available on port 19200.',
          category: 'platform',
          team: 'infra',
          tags: ['elasticsearch'],
          score: 1,
          keywordScore: 10,
          semanticScore: 0.8,
          sources: ['keyword', 'semantic'],
        },
        {
          documentId: 'document-1',
          chunkId: 'document-1:c1',
          title: 'Infrastructure Guide',
          content: 'RabbitMQ is available on port 15672.',
          category: 'platform',
          team: 'infra',
          tags: ['rabbitmq'],
          score: 0.8,
          keywordScore: 2,
          semanticScore: 0.7,
          sources: ['semantic'],
        },
        {
          documentId: 'document-1',
          chunkId: 'document-1:c2',
          title: 'Infrastructure Guide',
          content: 'Neo4j is available on port 17687.',
          category: 'platform',
          team: 'infra',
          tags: ['neo4j'],
          score: 0.7,
          keywordScore: 1,
          semanticScore: 0.6,
          sources: ['semantic'],
        },
        {
          documentId: 'document-2',
          chunkId: 'document-2:c0',
          title: 'Unrelated Guide',
          content: 'This document discusses onboarding.',
          category: 'hr',
          team: 'people',
          tags: ['onboarding'],
          score: 0.4,
          keywordScore: null,
          semanticScore: 0.5,
          sources: ['semantic'],
        },
      ],
      { topK: 5, maxChunksPerDocument: 2, maxContextCharacters: 1000 },
    );

    expect(result.map((item) => item.chunkId)).toEqual([
      'document-1:c0',
      'document-1:c1',
      'document-2:c0',
    ]);
    expect(result[0].rerankScore).toBeGreaterThan(result[1].rerankScore);
    expect(result.filter((item) => item.documentId === 'document-1')).toHaveLength(2);
  });

  it('respects the context character budget', () => {
    const service = new RerankService();
    const result = service.rerank(
      'search',
      [
        {
          documentId: 'document-1',
          chunkId: 'document-1:c0',
          title: 'Search',
          content: '12345',
          category: null,
          team: null,
          tags: [],
          score: 1,
          keywordScore: 1,
          semanticScore: 1,
          sources: ['keyword', 'semantic'],
        },
        {
          documentId: 'document-2',
          chunkId: 'document-2:c0',
          title: 'Search',
          content: '67890',
          category: null,
          team: null,
          tags: [],
          score: 0.9,
          keywordScore: 0.9,
          semanticScore: 0.9,
          sources: ['keyword', 'semantic'],
        },
      ],
      { topK: 5, maxContextCharacters: 5 },
    );

    expect(result).toHaveLength(1);
    expect(result[0].documentId).toBe('document-1');
  });
});
