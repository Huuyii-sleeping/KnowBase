import { describe, expect, it } from 'vitest';
import { readTokenUsage } from './token-usage';

describe('provider token usage normalization', () => {
  it('keeps normalized SDK counts, including actual zero and provider totals', () => {
    expect(
      readTokenUsage({
        usage_metadata: { input_tokens: 0, output_tokens: 8, total_tokens: 9 },
      }),
    ).toEqual({ inputTokens: 0, outputTokens: 8, totalTokens: 9 });
  });
  it('supports legacy Ollama counts and derives a total only from two known counts', () => {
    expect(
      readTokenUsage({
        response_metadata: { prompt_eval_count: 12, eval_count: 8 },
      }),
    ).toEqual({ inputTokens: 12, outputTokens: 8, totalTokens: 20 });
    expect(readTokenUsage({ usage_metadata: { input_tokens: 12 } })).toEqual({
      inputTokens: 12,
      outputTokens: null,
      totalTokens: null,
    });
  });
  it.each([
    undefined,
    null,
    { input_tokens: -1, output_tokens: NaN },
    { input_tokens: '12', output_tokens: 1.5 },
    { total_tokens: Infinity },
  ])('marks missing and malformed usage as unknown: %j', (usage_metadata) => {
    expect(readTokenUsage({ usage_metadata })).toEqual({
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
    });
  });
});
