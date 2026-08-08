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

function makeConfig(values: Record<string, string>) {
  return {
    get: vi.fn((key: string, fallback?: unknown) => values[key] ?? fallback),
  };
}

describe('EmbeddingService', () => {
  it('uses Ollama by default', async () => {
    const service = new EmbeddingService(makeConfig({}) as any);

    await expect(service.embedDocuments(['hello'])).resolves.toEqual([[0.1, 0.2]]);
    expect(ollamaEmbedDocuments).toHaveBeenCalledWith(['hello']);
  });

  it('supports switching back to OpenAI through configuration', async () => {
    const service = new EmbeddingService(
      makeConfig({
        EMBEDDING_PROVIDER: 'openai',
        OPENAI_API_KEY: 'test-key',
      }) as any,
    );

    await expect(service.embedDocuments(['hello'])).resolves.toEqual([[0.3, 0.4]]);
    expect(openAiEmbedDocuments).toHaveBeenCalledWith(['hello']);
  });
});
