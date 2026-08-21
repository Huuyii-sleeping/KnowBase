import { describe, expect, it, vi } from 'vitest';
import { KnowledgeGraphQueryService } from './knowledge-graph-query.service';

describe('KnowledgeGraphQueryService', () => {
  it('passes only the current user visible documents to Neo4j', async () => {
    const graphResult = [{
      seed: { key: '产品:knowbase', name: 'KnowBase', type: '产品' },
      entities: [],
      relations: [],
    }];
    const graphIndex = { searchRelated: vi.fn().mockResolvedValue(graphResult) };
    const service = new KnowledgeGraphQueryService(
      { findVisiblePublishedIds: vi.fn().mockResolvedValue(['document-1']) } as any,
      graphIndex as any,
    );

    await expect(service.search({ query: ' KnowBase ', maxHops: 2, limit: 20 }, { id: 'user-1' } as any)).resolves.toEqual({
      query: 'KnowBase',
      maxHops: 2,
      items: graphResult,
    });
    expect(graphIndex.searchRelated).toHaveBeenCalledWith({
      query: 'KnowBase',
      allowedDocumentIds: ['document-1'],
      maxHops: 2,
      limit: 20,
    });
  });
});
