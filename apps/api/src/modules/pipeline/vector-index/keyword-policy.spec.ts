import { describe, expect, it } from 'vitest';
import {
  keywordMatch,
  bodySlots,
  keywordPolicy,
  reserveBodyCandidates,
} from './keyword-policy';

describe('Keyword recall policy', () => {
  it('validates bounded body slots and applies different proportions without changing scores', () => {
    for (const value of ['', '0', '4', '1.5', 'x'])
      expect(() => bodySlots(value)).toThrow('BODY_SLOTS');
    const body = [0, 1, 2, 3].map((i) => ({ id: `b${i}`, score: i }));
    const context = [0, 1, 2].map((i) => ({ id: `c${i}`, score: i + 10 }));
    expect(bodySlots('3')).toBe(3);
    expect(reserveBodyCandidates(body, context, 4, 1)).toEqual([
      body[0],
      context[0],
      body[1],
      context[1],
    ]);
    expect(reserveBodyCandidates(body, context, 4, 3)).toEqual([
      body[0],
      body[1],
      body[2],
      context[0],
    ]);
    expect(() => reserveBodyCandidates(body, context, 4, 0)).toThrow(
      'BODY_SLOTS',
    );
    expect(reserveBodyCandidates(body, context, 0)).toEqual([]);
  });
  it('rejects unknown policies and leaves body-only matching unchanged', () => {
    expect(() => keywordPolicy('unknown')).toThrow('RAG_KEYWORD_POLICY');
    for (const policy of ['combined', 'weighted', 'body-reserve'] as const) {
      expect(keywordPolicy(policy)).toBe(policy);
      expect(keywordMatch('query', false, false, policy)).toEqual({
        match: { content: { query: 'query' } },
      });
    }
  });

  it('scores the original and enriched fields independently with explicit weights', () => {
    expect(keywordMatch('query', true, true, 'weighted')).toEqual({
      multi_match: {
        query: 'query',
        fields: ['content.cjk^2', 'retrieval_text.cjk'],
        type: 'best_fields',
        tie_breaker: 0.1,
      },
    });
    expect(keywordMatch('q', false, true, 'combined')).toEqual({
      match: { retrieval_text: { query: 'q' } },
    });
  });

  it('reserves two body slots per context slot, bounds output and preserves actual-hit scores', () => {
    const body = Array.from({ length: 15 }, (_, i) => ({
      id: `b${i}`,
      score: 15 - i,
    }));
    const context = Array.from({ length: 15 }, (_, i) => ({
      id: `c${i}`,
      score: 30 - i,
    }));
    const result = reserveBodyCandidates(body, context, 15);
    expect(result.map((c) => c.id)).toEqual([
      'b0',
      'b1',
      'c0',
      'b2',
      'b3',
      'c1',
      'b4',
      'b5',
      'c2',
      'b6',
      'b7',
      'c3',
      'b8',
      'b9',
      'c4',
    ]);
    expect(result[2].score).toBe(30);
    expect(body[0].id).toBe('b0');
    expect(context.length).toBe(15);
  });

  it('deduplicates only identical chunks and backfills when either list runs out', () => {
    const body = [
      { id: 'same', score: 8 },
      { id: 'doc:other-chunk', score: 7 },
    ];
    const context = [
      { id: 'same', score: 9 },
      { id: 'context', score: 6 },
    ];
    expect(reserveBodyCandidates(body, context, 10)).toEqual([
      ...body,
      context[1],
    ]);
    expect(reserveBodyCandidates([], context, 1)).toEqual(context.slice(0, 1));
    expect(reserveBodyCandidates(body, [], 5)).toEqual(body);
    expect(reserveBodyCandidates([], [], 5)).toEqual([]);
  });
});
