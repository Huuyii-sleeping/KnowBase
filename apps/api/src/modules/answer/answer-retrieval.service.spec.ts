import { describe, expect, it, vi } from 'vitest';
import { AnswerRetrievalService } from './answer-retrieval.service';

describe('AnswerRetrievalService', () => {
  const hybridItem = {
    documentId: 'doc-1',
    title: 'RAG 基础',
    content: 'RAG 是检索增强生成。',
    category: null,
    team: null,
    tags: [],
    score: 0.8,
    keywordScore: null,
    semanticScore: 0.8,
    sources: ['semantic'],
    rerankScore: 0.8,
  };

  it('adds graph paths for relationship questions', async () => {
    const graphQuery = {
      search: vi.fn().mockResolvedValue({
        items: [{
          seed: { name: 'RAG', type: '系统' },
          entities: [
            { name: 'RAG', type: '系统' },
            { name: 'Ollama', type: '技术' },
          ],
          relations: [{ documentId: 'doc-1', chunkId: 'chunk-1', type: '使用' }],
        }],
      }),
    };
    const service = new AnswerRetrievalService(
      { search: vi.fn().mockResolvedValue({ items: [hybridItem] }) } as any,
      graphQuery as any,
      { shouldUseGraph: vi.fn().mockReturnValue(true), extractTerms: vi.fn().mockReturnValue(['rag', 'ollama']) } as any,
    );

    const result = await service.retrieve('RAG 和 Ollama 有什么关系？', 3, { id: 'user-1' } as any);

    expect(result.graphUsed).toBe(true);
    expect(result.items).toHaveLength(2);
    expect(result.items[1]).toMatchObject({
      documentId: 'doc-1',
      chunkId: 'chunk-1',
      sources: ['graph'],
      title: '知识图谱路径：RAG',
    });
    expect(graphQuery.search).toHaveBeenCalledTimes(2);
  });

  it('keeps ordinary questions on hybrid retrieval only', async () => {
    const graphQuery = { search: vi.fn() };
    const service = new AnswerRetrievalService(
      { search: vi.fn().mockResolvedValue({ items: [hybridItem] }) } as any,
      graphQuery as any,
      { shouldUseGraph: vi.fn().mockReturnValue(false), extractTerms: vi.fn() } as any,
    );

    await expect(service.retrieve('RAG 的基本流程是什么？', 3, { id: 'user-1' } as any)).resolves.toEqual({
      items: [hybridItem],
      graphUsed: false,
    });
    expect(graphQuery.search).not.toHaveBeenCalled();
  });

  it('degrades to hybrid results when graph retrieval fails', async () => {
    const service = new AnswerRetrievalService(
      { search: vi.fn().mockResolvedValue({ items: [hybridItem] }) } as any,
      { search: vi.fn().mockRejectedValue(new Error('neo4j unavailable')) } as any,
      { shouldUseGraph: vi.fn().mockReturnValue(true), extractTerms: vi.fn().mockReturnValue(['rag']) } as any,
    );

    await expect(service.retrieve('RAG 和 Ollama 有什么关系？', 3, { id: 'user-1' } as any)).resolves.toEqual({
      items: [hybridItem],
      graphUsed: false,
    });
  });

  it('refuses to use ordinary context when a multi-entity relation has no graph path', async () => {
    const service = new AnswerRetrievalService(
      { search: vi.fn().mockResolvedValue({ items: [hybridItem] }) } as any,
      { search: vi.fn().mockResolvedValue({ items: [] }) } as any,
      { shouldUseGraph: vi.fn().mockReturnValue(true), extractTerms: vi.fn().mockReturnValue(['rag', 'ollama']) } as any,
    );

    await expect(service.retrieve('RAG 和 Ollama 有什么关系？', 3, { id: 'user-1' } as any)).resolves.toEqual({
      items: [],
      graphUsed: false,
    });
  });
});
