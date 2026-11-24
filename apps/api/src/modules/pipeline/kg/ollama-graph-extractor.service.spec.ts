import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());

vi.mock('@langchain/ollama', () => ({
  ChatOllama: class ChatOllama {
    invoke = invoke;
  },
}));

import { OllamaGraphExtractorService } from './ollama-graph-extractor.service';
import { GraphExtractionParseError } from './graph-extractor.types';

describe('OllamaGraphExtractorService', () => {
  it('fingerprints explicit model revisions, extraction settings and prompts without exposing endpoints', () => {
    const make = (settings = {}) =>
      new OllamaGraphExtractorService(new ConfigService(settings));
    expect(make().fingerprint).toBeUndefined();
    const config = {
      OLLAMA_KG_MODEL_REVISION: 'sha256:model-v1',
      OLLAMA_BASE_URL: 'https://user:secret@example.org',
    };
    const first = make(config).fingerprint;
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).toBe(make(config).fingerprint);
    expect(first).not.toBe(
      make({ ...config, OLLAMA_KG_SEED: '1' }).fingerprint,
    );
    expect(first).not.toBe(
      make({ ...config, OLLAMA_KG_MODEL_REVISION: 'sha256:model-v2' })
        .fingerprint,
    );
  });
  it('parses JSON returned inside a model code fence', async () => {
    invoke.mockResolvedValueOnce({
      content:
        '```json\n{"entities":[{"name":"KnowBase","type":"产品"}],"relations":[]}\n```',
    });
    const service = new OllamaGraphExtractorService({
      get: vi.fn((_key: string, fallback: unknown) => fallback),
    } as any);

    await expect(service.extract('# KnowBase')).resolves.toEqual({
      entities: [{ name: 'KnowBase', type: '产品' }],
      relations: [],
    });
    expect(invoke).toHaveBeenCalledWith(expect.stringContaining('# KnowBase'));
  });

  it('fails malformed model output without producing an empty graph', async () => {
    invoke.mockResolvedValueOnce({ content: '无法抽取' });
    const service = new OllamaGraphExtractorService({
      get: vi.fn((_key: string, fallback: unknown) => fallback),
    } as any);

    await expect(service.extract('text')).rejects.toThrow(
      GraphExtractionParseError,
    );
  });
});
