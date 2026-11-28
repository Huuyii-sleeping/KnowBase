import { describe, expect, it, vi } from 'vitest';

const ollamaEmbedDocuments = vi.fn().mockResolvedValue([[0.1, 0.2]]);
const ollamaEmbedQuery = vi.fn().mockResolvedValue([0.1, 0.2]);
const openAiEmbedQuery = vi.fn().mockResolvedValue([0.3, 0.4]);
const openAiEmbedDocuments = vi.fn().mockResolvedValue([[0.3, 0.4]]);
const ollamaOptions = vi.fn();

vi.mock('@langchain/ollama', () => ({
  OllamaEmbeddings: class OllamaEmbeddings {
    constructor(options: unknown) {
      ollamaOptions(options);
    }
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

function makeConfig(values: Record<string, string | undefined>) {
  return {
    get: vi.fn(
      (key: string, fallback?: unknown) =>
        values[key] ?? (key === 'RAG_EMBEDDING_DIMENSIONS' ? 2 : fallback),
    ),
  };
}

describe('EmbeddingService', () => {
  it('requires an explicit model revision to enable reuse and invalidates configuration changes', () => {
    expect(
      new EmbeddingService(makeConfig({}) as any).fingerprint,
    ).toBeUndefined();
    const initial = new EmbeddingService(
      makeConfig({ EMBEDDING_MODEL_REVISION: 'sha256:model1' }) as any,
    ).fingerprint;
    expect(initial).toMatch(/^[a-f0-9]{64}$/);
    expect(
      new EmbeddingService(
        makeConfig({ EMBEDDING_MODEL_REVISION: 'sha256:model2' }) as any,
      ).fingerprint,
    ).not.toBe(initial);
    expect(
      new EmbeddingService(
        makeConfig({
          EMBEDDING_MODEL_REVISION: 'sha256:model1',
          OLLAMA_BASE_URL: 'http://other',
        }) as any,
      ).fingerprint,
    ).not.toBe(initial);
  });

  it.each([
    { EMBEDDING_PROVIDER: 'unknown' },
    { RAG_EMBEDDING_BATCH_SIZE: '0' },
    { RAG_EMBEDDING_CONCURRENCY: 'NaN' },
  ])('rejects unsupported providers or invalid limits', (config) => {
    expect(() => new EmbeddingService(makeConfig(config) as any)).toThrow();
  });

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
    expect(ollamaOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({ truncate: false }),
    );
  });

  it('rejects actual token overflow before calling the OpenAI embedding provider', () => {
    const service = new EmbeddingService(
      makeConfig({
        EMBEDDING_PROVIDER: 'openai',
        OPENAI_API_KEY: 'fixture',
        RAG_EMBEDDING_MAX_TOKENS: '5',
      }) as any,
    );
    openAiEmbedDocuments.mockClear();
    expect(() => service.embedDocuments([' word'.repeat(6)])).toThrow('tokens');
    expect(openAiEmbedDocuments).not.toHaveBeenCalled();
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

describe('Embedding task prefix integration', () => {
  it('fingerprints both prefixes and returns unprefixed batch texts for checkpoint keys', async () => {
    const config = {
      EMBEDDING_MODEL_REVISION: 'immutable',
      EMBEDDING_DOCUMENT_PREFIX: 'search_document: ',
      EMBEDDING_QUERY_PREFIX: 'search_query: ',
    };
    const service = new EmbeddingService(makeConfig(config) as any);
    const batch = vi.fn(async () => {});
    await service.embedDocuments(['body', 'body'], batch);
    expect(batch).toHaveBeenCalledWith(['body'], [[0.1, 0.2]]);
    for (const key of ['EMBEDDING_DOCUMENT_PREFIX', 'EMBEDDING_QUERY_PREFIX'])
      expect(
        new EmbeddingService(makeConfig({ ...config, [key]: 'changed' }) as any)
          .fingerprint,
      ).not.toBe(service.fingerprint);
  });
  it('validates token budgets on the final document/query input and rejects invalid query vectors', async () => {
    const service = new EmbeddingService(
      makeConfig({
        EMBEDDING_PROVIDER: 'openai',
        RAG_EMBEDDING_MAX_TOKENS: '5',
        EMBEDDING_DOCUMENT_PREFIX: 'prefix '.repeat(8),
        EMBEDDING_QUERY_PREFIX: 'query '.repeat(8),
      }) as any,
    );
    openAiEmbedDocuments.mockClear();
    openAiEmbedQuery.mockClear();
    expect(() => service.validateInputs(['body'])).toThrow('tokens');
    await expect(service.embedQuery('body')).rejects.toThrow('tokens');
    expect(openAiEmbedDocuments).not.toHaveBeenCalled();
    expect(openAiEmbedQuery).not.toHaveBeenCalled();
    const query = new EmbeddingService(makeConfig({}) as any);
    ollamaEmbedQuery.mockResolvedValueOnce([0, 0]);
    await expect(query.embedQuery('question')).rejects.toThrow('Invalid query');
  });
  it('counts task prefixes toward character budgets before sending requests or trusting caches', async () => {
    const service = new EmbeddingService(
      makeConfig({
        RAG_EMBEDDING_BATCH_CHARACTERS: '8',
        EMBEDDING_DOCUMENT_PREFIX: 'prefix: ',
        EMBEDDING_QUERY_PREFIX: 'prefix: ',
      }) as any,
    );
    expect(() => service.validateInputs(['body'])).toThrow('CHARACTERS');
    await expect(service.embedQuery('body')).rejects.toThrow('CHARACTERS');
  });
});
