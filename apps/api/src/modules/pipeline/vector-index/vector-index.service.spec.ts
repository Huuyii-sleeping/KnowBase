import { describe, expect, it, vi } from 'vitest';

const { searchMock } = vi.hoisted(() => ({
  searchMock: vi.fn(),
}));

vi.mock('@elastic/elasticsearch', () => ({
  Client: class Client {
    indices = {
      exists: vi.fn(),
      create: vi.fn(),
    };

    search = searchMock;
    close = vi.fn();
  },
}));

import { VectorIndexService } from './vector-index.service';

describe('VectorIndexService document search', () => {
  it('queries published documents with keyword, filters, pagination, and highlights', async () => {
    searchMock.mockResolvedValue({
      hits: {
        total: { value: 1, relation: 'eq' },
        hits: [{
          _id: 'document-1',
          _score: 4.2,
          _source: {
            id: 'document-1',
            title: 'RabbitMQ Pipeline',
            fileName: 'pipeline.md',
            category: 'platform',
            team: 'infra',
            tags: ['mq'],
            version: 2,
          },
          highlight: {
            content: ['...<em>RabbitMQ</em>...'],
          },
        }],
      },
    });
    const service = new VectorIndexService({
      get: vi.fn((_key: string, fallback: unknown) => fallback),
    } as any);

    await expect(service.searchDocuments({
      keyword: 'RabbitMQ',
      category: 'platform',
      team: 'infra',
      tag: 'mq',
      page: 2,
      pageSize: 10,
    })).resolves.toEqual({
      items: [{
        id: 'document-1',
        title: 'RabbitMQ Pipeline',
        fileName: 'pipeline.md',
        category: 'platform',
        team: 'infra',
        tags: ['mq'],
        version: 2,
        score: 4.2,
        highlights: { content: ['...<em>RabbitMQ</em>...'] },
      }],
      page: 2,
      pageSize: 10,
      total: 1,
    });

    expect(searchMock).toHaveBeenCalledWith(expect.objectContaining({
      index: 'kh_document',
      from: 10,
      size: 10,
      track_total_hits: true,
      query: {
        bool: {
          must: [{
            multi_match: expect.objectContaining({
              query: 'RabbitMQ',
              fields: ['title^3', 'content', 'tags^2', 'category', 'team'],
              type: 'best_fields',
            }),
          }],
          filter: [
            { term: { status: 'PUBLISHED' } },
            { term: { category: 'platform' } },
            { term: { team: 'infra' } },
            { term: { tags: 'mq' } },
          ],
        },
      },
      highlight: expect.any(Object),
    }));
  });

  it('supports browsing published documents without a keyword', async () => {
    searchMock.mockResolvedValueOnce({
      hits: { total: 0, hits: [] },
    });
    const service = new VectorIndexService({
      get: vi.fn((_key: string, fallback: unknown) => fallback),
    } as any);

    await service.searchDocuments({
      page: 1,
      pageSize: 20,
    });

    expect(searchMock).toHaveBeenLastCalledWith(expect.objectContaining({
      query: {
        bool: {
          must: [{ match_all: {} }],
          filter: [{ term: { status: 'PUBLISHED' } }],
        },
      },
      sort: [{ updatedAt: 'desc' }],
    }));
  });

  it('runs a KNN query against chunk embeddings', async () => {
    searchMock.mockReset();
    searchMock.mockResolvedValue({
      hits: {
        hits: [{
          _id: 'document-1:v1:c0',
          _score: 0.91,
          _source: {
            document_id: 'document-1',
            document_version: 1,
            chunk_index: 0,
            content: '# RabbitMQ',
          },
        }],
      },
    });
    const service = new VectorIndexService({
      get: vi.fn((_key: string, fallback: unknown) => fallback),
    } as any);

    await expect(service.searchChunks({
      queryVector: [0.1, 0.2],
      topK: 3,
    })).resolves.toEqual([{
      id: 'document-1:v1:c0',
      documentId: 'document-1',
      version: 1,
      chunkIndex: 0,
      content: '# RabbitMQ',
      score: 0.91,
    }]);

    expect(searchMock).toHaveBeenCalledWith({
      index: 'kh_chunk',
      size: 3,
      knn: {
        field: 'embedding',
        query_vector: [0.1, 0.2],
        k: 3,
        num_candidates: 100,
      },
    });
  });
});
