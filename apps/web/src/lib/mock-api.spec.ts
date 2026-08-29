import { describe, expect, it } from 'vitest';
import { mockDocumentsApi, mockGraphApi } from './mock-api';

describe('mock api graph fixtures', () => {
  it('filters graph paths by hop count and keeps RAG paths realistic', async () => {
    const oneHop = await mockGraphApi.search('RAG', 1, 12);
    const twoHops = await mockGraphApi.search('RAG', 2, 12);

    expect(oneHop.items.length).toBeGreaterThan(0);
    expect(oneHop.items.every((path) => path.relations.length === 1)).toBe(true);
    expect(twoHops.items.some((path) => path.relations.length === 2)).toBe(true);
  });

  it('uses published documents as provenance for graph results', async () => {
    const published = await mockDocumentsApi.list({ status: 'PUBLISHED' });
    const publishedIds = new Set(published.items.map((item) => item.id));
    const result = await mockGraphApi.search('KnowledgeDocument', 2, 12);

    expect(result.items.length).toBeGreaterThan(0);
    for (const relation of result.items.flatMap((path) => path.relations)) {
      expect(publishedIds.has(relation.documentId)).toBe(true);
      expect(relation.chunkId).toContain(':v');
      expect(relation.chunkId).toContain(':c');
    }
  });

  it('returns source-specific markdown for graph validation docs', async () => {
    const docs = await mockDocumentsApi.list({ keyword: '知识图谱构建说明' });
    expect(docs.items[0]).toBeDefined();

    const detail = await mockDocumentsApi.detail(docs.items[0].id);
    expect(detail.content?.markdown).toContain('KnowledgeDocument');
    expect(detail.content?.markdown).toContain('RELATED_TO');
  });
});
