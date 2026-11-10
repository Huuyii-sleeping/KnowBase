import { describe, expect, it } from 'vitest';
import { mergeChunkCandidates } from './hybrid-candidates';

const chunk = (chunkId: string, score: number | null = 1) => ({
  chunkId,
  documentId: 'doc',
  documentVersion: 2,
  chunkIndex: 0,
  content: `正文 ${chunkId}`,
  score,
  document: { title: 'Title', category: null, team: null, tags: ['tag'] },
});

describe('mergeChunkCandidates', () => {
  it('unifies identical chunks while retaining their bodies and separate route scores', () => {
    const [item] = mergeChunkCandidates([chunk('a', 10)], [chunk('a', 0.8)]);
    expect(item).toMatchObject({
      chunkId: 'a',
      content: '正文 a',
      keywordScore: 10,
      semanticScore: 0.8,
      sources: ['keyword', 'semantic'],
      score: 1,
    });
  });
  it('keeps different paragraphs of the same document separate and never transfers keyword credit', () => {
    const items = mergeChunkCandidates(
      [chunk('first', 10)],
      [chunk('second', 0.8)],
    );
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      chunkId: 'first',
      content: '正文 first',
      semanticScore: null,
      sources: ['keyword'],
    });
    expect(items[1]).toMatchObject({
      chunkId: 'second',
      keywordScore: null,
      sources: ['semantic'],
    });
  });
  it('preserves keyword-only evidence when the semantic route is empty', () => {
    expect(mergeChunkCandidates([chunk('a', 10)], [])).toEqual([
      expect.objectContaining({ content: '正文 a', sources: ['keyword'] }),
    ]);
    expect(mergeChunkCandidates([], [])).toEqual([]);
  });
  it('deduplicates repeated chunks and produces finite scores when native scores are missing', () => {
    const items = mergeChunkCandidates(
      [chunk('a', null), chunk('a', null)],
      [chunk('a', null)],
    );
    expect(items).toHaveLength(1);
    expect(items[0].score).toBe(0);
  });
});
