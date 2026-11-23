import { describe, expect, it, vi } from 'vitest';

const ollamaEmbedDocuments = vi.fn().mockResolvedValue([[0.1, 0.2]]);
const openAiEmbedDocuments = vi.fn().mockResolvedValue([[0.3, 0.4]]);

vi.mock('@langchain/ollama', () => ({
  OllamaEmbeddings: class OllamaEmbeddings {
    embedDocuments = ollamaEmbedDocuments;
  },
}));

vi.mock('@langchain/openai', () => ({
  OpenAIEmbeddings: class OpenAIEmbeddings {
    embedDocuments = openAiEmbedDocuments;
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
