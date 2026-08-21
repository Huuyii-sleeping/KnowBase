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
  it('parses JSON returned inside a model code fence', async () => {
    invoke.mockResolvedValueOnce({
      content: '```json\n{"entities":[{"name":"KnowBase","type":"产品"}],"relations":[]}\n```',
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

    await expect(service.extract('text')).rejects.toThrow(GraphExtractionParseError);
  });
});
