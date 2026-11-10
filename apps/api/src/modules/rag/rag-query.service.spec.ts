import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';

vi.mock('../documents/entities/document.entity', () => ({
  Document: class Document {},
  DocumentStatus: {
    DRAFT: 'DRAFT',
    PENDING_REVIEW: 'PENDING_REVIEW',
    PUBLISHED: 'PUBLISHED',
    REJECTED: 'REJECTED',
  },
}));

import { DocumentStatus } from '../documents/entities/document.entity';
import { RagQueryService } from './rag-query.service';

describe('RagQueryService', () => {
  it('rejects invalid internal budgets and empty questions before querying stores', async () => {
    const embedding = { embedQuery: vi.fn() };
    const index = { searchChunks: vi.fn() };
    const service = new RagQueryService(
      embedding as any,
      index as any,
      {} as any,
    );
    for (const topK of [0, -1, 101, 1.5])
      await expect(
        service.recall({ query: '问题', topK }, 'semantic'),
      ).rejects.toThrow('candidate budget');
    await expect(
      service.recall({ query: '  ', topK: 5 }, 'semantic'),
    ).rejects.toThrow('non-empty');
    expect(embedding.embedQuery).not.toHaveBeenCalled();
    expect(index.searchChunks).not.toHaveBeenCalled();
  });

  it('does no embedding or index work when the user has no visible published documents', async () => {
    const embedding = { embedQuery: vi.fn() };
    const index = { searchChunks: vi.fn(), searchKeywordChunks: vi.fn() };
    const query = { findVisiblePublishedIds: vi.fn().mockResolvedValue([]) };
    const service = new RagQueryService(
      embedding as any,
      index as any,
      query as any,
    );
    const user = { id: 'user' } as any;
    for (const route of ['keyword', 'semantic'] as const) {
      expect(
        await service.recall({ query: '问题', topK: 5 }, route, user),
      ).toMatchObject({ items: [], rawCandidates: [] });
    }
    expect(embedding.embedQuery).not.toHaveBeenCalled();
    expect(index.searchChunks).not.toHaveBeenCalled();
    expect(index.searchKeywordChunks).not.toHaveBeenCalled();
  });

  it('retains raw candidates only in internal traces and keeps public responses filtered', async () => {
    const stale = {
      id: 'stale',
      documentId: 'doc',
      version: 1,
      chunkIndex: 0,
      content: 'old',
      score: 9,
    };
    const current = {
      ...stale,
      id: 'current',
      version: 2,
      content: 'evidence',
    };
    const service = new RagQueryService(
      {} as any,
      {
        searchKeywordChunks: vi.fn().mockResolvedValue([stale, current]),
      } as any,
      {
        findEntity: vi
          .fn()
          .mockResolvedValue({
            status: DocumentStatus.PUBLISHED,
            version: 2,
            title: 'Title',
            tags: [],
          }),
      } as any,
    );
    const trace = await service.recall(
      { query: 'evidence', topK: 1 },
      'keyword',
    );
    expect(trace.rawCandidates).toEqual([stale, current]);
    expect(trace.items.map((item) => item.chunkId)).toEqual(['current']);
    expect(trace.elapsedMs).toBeGreaterThanOrEqual(0);
    const response = await service.searchKeywordChunks({
      query: 'evidence',
      topK: 1,
    });
    expect(Object.keys(response).sort()).toEqual(['items', 'query', 'topK']);
  });
  it('embeds the question and returns only chunks from published documents', async () => {
    const embedding = {
      embedQuery: vi.fn().mockResolvedValue([0.9, 0.8]),
    };
    const vectorIndex = {
      searchChunks: vi.fn().mockResolvedValue([
        {
          id: 'draft:v1:c0',
          documentId: 'draft',
          version: 1,
          chunkIndex: 0,
          content: 'draft content',
          score: 0.99,
        },
        {
          id: 'published:v2:c1',
          documentId: 'published',
          version: 2,
          chunkIndex: 1,
          content: 'published content',
          score: 0.88,
        },
        {
          id: 'published:v1:c0',
          documentId: 'published',
          version: 1,
          chunkIndex: 0,
          content: 'obsolete version',
          score: 0.85,
        },
        {
          id: 'missing:v1:c0',
          documentId: 'missing',
          version: 1,
          chunkIndex: 0,
          content: 'stale content',
          score: 0.8,
        },
      ]),
    };
    const documentQuery = {
      findEntity: vi.fn(async (id: string) => {
        if (id === 'draft') {
          return {
            status: DocumentStatus.DRAFT,
            title: 'Draft',
            category: 'docs',
            team: 'platform',
            tags: [],
          };
        }
        if (id === 'published') {
          return {
            status: DocumentStatus.PUBLISHED,
            version: 2,
            title: 'Published',
            category: 'docs',
            team: 'platform',
            tags: ['rag'],
          };
        }
        throw new NotFoundException('document not found');
      }),
    };
    const service = new RagQueryService(
      embedding as any,
      vectorIndex as any,
      documentQuery as any,
    );

    await expect(
      service.search({
        query: '  how does retrieval work?  ',
        topK: 1,
      }),
    ).resolves.toEqual({
      query: 'how does retrieval work?',
      topK: 1,
      items: [
        {
          chunkId: 'published:v2:c1',
          documentId: 'published',
          documentVersion: 2,
          chunkIndex: 1,
          content: 'published content',
          score: 0.88,
          document: {
            title: 'Published',
            category: 'docs',
            team: 'platform',
            tags: ['rag'],
          },
        },
      ],
    });

    expect(embedding.embedQuery).toHaveBeenCalledWith(
      'how does retrieval work?',
    );
    expect(vectorIndex.searchChunks).toHaveBeenCalledWith({
      queryVector: [0.9, 0.8],
      topK: 3,
    });
  });

  it('fails when the embedding provider returns no vector', async () => {
    const service = new RagQueryService(
      { embedQuery: vi.fn().mockResolvedValue([]) } as any,
      { searchChunks: vi.fn() } as any,
      { findEntity: vi.fn() } as any,
    );

    await expect(
      service.search({ query: 'question', topK: 5 }),
    ).rejects.toThrow('embedding provider returned no query vector');
  });

  it('loads keyword evidence with ACLs and rejects missing, draft and obsolete versions without embedding', async () => {
    const embedding = { embedDocuments: vi.fn() };
    const vectorIndex = {
      searchKeywordChunks: vi.fn().mockResolvedValue([
        {
          id: 'old',
          documentId: 'doc',
          version: 1,
          chunkIndex: 0,
          content: 'old',
        },
        {
          id: 'draft',
          documentId: 'draft',
          version: 1,
          chunkIndex: 0,
          content: 'draft',
        },
        {
          id: 'missing',
          documentId: 'missing',
          version: 1,
          chunkIndex: 0,
          content: 'missing',
        },
        {
          id: 'current',
          documentId: 'doc',
          version: 2,
          chunkIndex: 1,
          content: 'evidence',
          score: 7,
        },
      ]),
    };
    const documentQuery = {
      findVisiblePublishedIds: vi.fn().mockResolvedValue(['doc']),
      findEntity: vi.fn(async (id) => {
        if (id === 'missing') throw new NotFoundException();
        return {
          status:
            id === 'draft' ? DocumentStatus.DRAFT : DocumentStatus.PUBLISHED,
          version: 2,
          title: 'Title',
          category: null,
          team: null,
          tags: [],
        };
      }),
    };
    const user = { id: 'user', role: 'MEMBER' as const };
    const service = new RagQueryService(
      embedding as any,
      vectorIndex as any,
      documentQuery as any,
    );
    expect(
      await service.searchKeywordChunks({ query: ' evidence ', topK: 1 }, user),
    ).toMatchObject({
      query: 'evidence',
      topK: 1,
      items: [{ chunkId: 'current', content: 'evidence', documentVersion: 2 }],
    });
    expect(vectorIndex.searchKeywordChunks).toHaveBeenCalledWith({
      query: 'evidence',
      topK: 3,
      allowedDocumentIds: ['doc'],
    });
    expect(documentQuery.findVisiblePublishedIds).toHaveBeenCalledWith(user);
    expect(embedding.embedDocuments).not.toHaveBeenCalled();
  });
});
