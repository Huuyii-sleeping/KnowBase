import { describe, expect, it } from 'vitest';
import { AnswerCitationService } from './answer-citation.service';

const item = (documentId: string, title: string) => ({
  documentId,
  title,
  category: null,
  team: null,
  tags: [],
  score: 0.8,
  keywordScore: null,
  semanticScore: 0.8,
  sources: ['semantic'] as const,
  rerankScore: 0.7,
});

describe('AnswerCitationService', () => {
  it('keeps only valid, unique citations from the answer', () => {
    expect(new AnswerCitationService().build('结论 [S2]，再次引用 [S2] 和 [S9]。', [
      item('doc-1', '第一篇'),
      item('doc-2', '第二篇'),
    ])).toEqual([{
      sourceId: 'S2',
      documentId: 'doc-2',
      title: '第二篇',
      score: 0.7,
    }]);
  });

  it('falls back to the first context when the model omits citations', () => {
    expect(new AnswerCitationService().build('没有标注来源的回答', [
      item('doc-1', '第一篇'),
    ])).toEqual([{
      sourceId: 'S1',
      documentId: 'doc-1',
      title: '第一篇',
      score: 0.7,
    }]);
  });
});
