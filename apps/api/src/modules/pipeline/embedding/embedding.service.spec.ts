import { describe, expect, it, vi } from 'vitest';

const ollamaEmbedDocuments = vi.fn().mockResolvedValue([[0.1, 0.2]]);
const ollamaEmbedQuery = vi.fn().mockResolvedValue([0.1, 0.2]);
const openAiEmbedQuery = vi.fn().mockResolvedValue([0.3, 0.4]);
const openAiEmbedDocuments = vi.fn().mockResolvedValue([[0.3, 0.4]]);

vi.mock('@langchain/ollama', () => ({
  OllamaEmbeddings: class OllamaEmbeddings {
    embedDocuments = ollamaEmbedDocuments;
    embedQuery = ollamaEmbedQuery;
  },
}));

vi.mock('@langchain/openai', () => ({
  OpenAIEmbeddings: class OpenAIEmbeddings {
    embedDocuments = openAiEmbedDocuments;
    embedQuery = openAiEmbedQuery;
  },
}));

import { EmbeddingService } from './embedding.service';

function makeConfig(values: Record<string, string>) {
  return {
    get: vi.fn((key: string, fallback?: unknown) => values[key] ?? fallback),
  };
}

describe('EmbeddingService', () => {
  it('separates query encoding from document encoding while preserving empty-prefix defaults', async () => {
    const service = new EmbeddingService(makeConfig({}) as any);
    expect(await service.embedQuery('问题')).toEqual([0.1, 0.2]);
    expect(ollamaEmbedQuery).toHaveBeenCalledWith('问题');
  });

  it('applies explicit asymmetric task prefixes without altering stored text', async () => {
    const service = new EmbeddingService(
      makeConfig({
        EMBEDDING_DOCUMENT_PREFIX: 'search_document: ',
        EMBEDDING_QUERY_PREFIX: 'search_query: ',
      }) as any,
    );
    const texts = ['原文'];
    await service.embedDocuments(texts);
    await service.embedQuery('问题');
    expect(ollamaEmbedDocuments).toHaveBeenCalledWith([
      'search_document: 原文',
    ]);
    expect(ollamaEmbedQuery).toHaveBeenCalledWith('search_query: 问题');
    expect(texts).toEqual(['原文']);
  });

  it('uses the selected provider query contract and propagates embedding failures', async () => {
    const service = new EmbeddingService(
      makeConfig({ EMBEDDING_PROVIDER: 'openai' }) as any,
    );
    expect(await service.embedQuery('问题')).toEqual([0.3, 0.4]);
    expect(openAiEmbedQuery).toHaveBeenCalledWith('问题');
    openAiEmbedQuery.mockRejectedValueOnce(new Error('provider failed'));
    await expect(service.embedQuery('问题')).rejects.toThrow('provider failed');
    expect(
      () =>
        new EmbeddingService(
          makeConfig({ EMBEDDING_PROVIDER: 'invalid' }) as any,
        ),
    ).toThrow('unsupported embedding provider');
  });
  it('uses Ollama by default', async () => {
    const service = new EmbeddingService(makeConfig({}) as any);

    await expect(service.embedDocuments(['hello'])).resolves.toEqual([
      [0.1, 0.2],
    ]);
    expect(ollamaEmbedDocuments).toHaveBeenCalledWith(['hello']);
  });

  it('supports switching back to OpenAI through configuration', async () => {
    const service = new EmbeddingService(
      makeConfig({
        EMBEDDING_PROVIDER: 'openai',
        OPENAI_API_KEY: 'test-key',
      }) as any,
    );

    await expect(service.embedDocuments(['hello'])).resolves.toEqual([
      [0.3, 0.4],
    ]);
    expect(openAiEmbedDocuments).toHaveBeenCalledWith(['hello']);
  });
});
