import { describe, expect, it } from 'vitest';
import { getEncoding } from 'js-tiktoken';
import { EmbeddingInputBudget } from './embedding-input-budget';

describe('model-specific embedding token budget', () => {
  it('uses real bundled cl100k tokens for Chinese, emoji, source code and numeric text at the boundary', () => {
    const encoder = getEncoding('cl100k_base');
    for (const text of [
      '质量部未批准放行，退款-7350.50元。',
      '😀😀😀<|endoftext|>',
      'const release = false;\n'.repeat(20),
    ]) {
      const tokens = encoder.encode(text, [], []).length;
      expect(() =>
        new EmbeddingInputBudget(
          'openai',
          'text-embedding-3-small',
          tokens,
        ).validate([text]),
      ).not.toThrow();
      expect(() =>
        new EmbeddingInputBudget(
          'openai',
          'text-embedding-3-small',
          tokens - 1,
        ).validate([text]),
      ).toThrow('tokens');
    }
  });
  it('enforces the known model limit even if configuration requests a higher value', () => {
    expect(() =>
      new EmbeddingInputBudget(
        'openai',
        'text-embedding-3-large',
        10000,
      ).validate([' word'.repeat(8200)]),
    ).toThrow('8191');
    expect(() =>
      new EmbeddingInputBudget('openai', 'text-embedding-ada-002').validate([
        ' word'.repeat(8192),
      ]),
    ).toThrow('8191');
  });
  it('never applies an unrelated tokenizer to Ollama or arbitrary compatible model names', () => {
    expect(() =>
      new EmbeddingInputBudget('ollama', 'nomic-embed-text').validate([
        '任意文本',
      ]),
    ).not.toThrow();
    expect(() =>
      new EmbeddingInputBudget('openai', 'private-model').validate([
        '任意文本',
      ]),
    ).not.toThrow();
    expect(
      () => new EmbeddingInputBudget('ollama', 'nomic-embed-text', 100),
    ).toThrow('supported');
    expect(
      () => new EmbeddingInputBudget('openai', 'private-model', 100),
    ).toThrow('supported');
    for (const limit of [0, -1, NaN, Infinity, 1.5])
      expect(
        () =>
          new EmbeddingInputBudget('openai', 'text-embedding-3-small', limit),
      ).toThrow();
  });
});
