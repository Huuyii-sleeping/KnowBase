import { describe, expect, it } from 'vitest';
import { AnswerCitationService } from './answer-citation.service';

const item = (
  documentId: string,
  title: string,
  source: 'semantic' | 'graph' = 'semantic',
) => ({
  documentId,
  title,
  category: null,
  team: null,
  tags: [],
  score: 0.8,
  keywordScore: null,
  semanticScore: 0.8,
  sources: [source] as const,
  rerankScore: 0.7,
});

describe('AnswerCitationService', () => {
  it('keeps only valid, unique citations from the answer', () => {
    expect(
      new AnswerCitationService().build('结论 [S2]，再次引用 [S2] 和 [S9]。', [
        item('doc-1', '第一篇'),
        item('doc-2', '第二篇'),
      ]),
    ).toEqual([
      {
        sourceId: 'S2',
        documentId: 'doc-2',
        title: '第二篇',
        score: 0.7,
        sourceType: 'semantic',
      },
    ]);
  });

  it('never invents a source when the model omits citations', () => {
    expect(
      new AnswerCitationService().build('没有标注来源的回答', [
        item('doc-1', '第一篇'),
      ]),
    ).toEqual([]);
    const service = new AnswerCitationService();
    expect(service.hasValidMarkers('事实 [S1][S2]', 2)).toBe(true);
    for (const answer of [
      '事实',
      '事实 [S0]',
      '事实 [S3]',
      '事实 [S1][S9]',
      '事实 [S-1]',
      '事实 [S1][Sfoo]',
      '事实 [S01]',
      '事实 [S99999999999999999]',
    ]) {
      expect(service.hasValidMarkers(answer, 2)).toBe(false);
    }
    expect(service.hasValidMarkers('事实 [S1]', 0)).toBe(false);
  });

  it('preserves graph as an explicit citation source type', () => {
    expect(
      new AnswerCitationService().build('关系见 [S1]', [
        item('doc-1', 'RAG 关系路径', 'graph'),
      ]),
    ).toMatchObject([{ sourceId: 'S1', sourceType: 'graph' }]);
  });
});
