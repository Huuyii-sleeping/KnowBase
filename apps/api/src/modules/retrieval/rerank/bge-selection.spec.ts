import { describe, expect, it } from 'vitest';
import { selectBge } from './bge-selection';
import { RerankService } from './rerank.service';

import { candidate } from './bge.fixture';

describe('BGE protected selection', () => {
  it('reserves rule membership, fills by model scores and exposes the same final scores to consumers', () => {
    const pool = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) =>
      candidate(id, 10 - i),
    );
    const baseline = new RerankService().rerank('证据', pool, { topK: 5 });
    const scores = new Map([
      ['a', -9],
      ['b', -8],
      ['c', 1],
      ['d', 2],
      ['e', 3],
      ['f', 4],
    ]);
    const before = structuredClone(pool);
    const result = selectBge(pool, baseline, scores, { topK: 5 });
    expect(result.map((x) => x.chunkId)).toEqual(['f', 'e', 'd', 'b', 'a']);
    expect(result.map((x) => x.rerankModelScore)).toEqual([4, 3, 2, -8, -9]);
    expect(result.map((x) => x.rerankScore)).toEqual([
      5 / 6,
      4 / 6,
      3 / 6,
      2 / 6,
      1 / 6,
    ]);
    expect(result[0]).toMatchObject({
      sources: ['keyword'],
      keywordScore: 5,
      content: '正文证据',
    });
    expect(pool).toEqual(before);
  });

  it('keeps stable ties, document and UTF16 budgets and the first oversized exception', () => {
    const pool = [
      candidate('a', 5),
      candidate('b', 4),
      candidate('c', 3),
      candidate('d', 2),
    ];
    pool[0].content = '😀'; // two UTF16 characters, as in the production rule.
    pool[1].content = '12';
    pool[2].content = '34';
    pool[1].documentId = 'a';
    const rule = new RerankService();
    const options = {
      topK: 3,
      maxChunksPerDocument: 1,
      maxContextCharacters: 4,
    };
    const base = rule.rerank('证据', pool, options);
    expect(
      selectBge(
        pool,
        base,
        new Map(pool.map((x) => [x.chunkId!, 1])),
        options,
      ).map((x) => x.chunkId),
    ).toEqual(['a', 'c']);
    const oversized = { topK: 1, maxContextCharacters: 1 };
    expect(
      selectBge(
        pool,
        rule.rerank('证据', pool, oversized),
        new Map(pool.map((x) => [x.chunkId!, 1])),
        oversized,
      ),
    ).toHaveLength(1);
    expect(selectBge([], [], new Map(), { topK: 5 })).toEqual([]);
  });
});
