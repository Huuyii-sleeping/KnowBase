import { describe, expect, it } from 'vitest';
import { AnswerCitationService } from './answer-citation.service';

const item = (
  documentId: string,
  title: string,
  source: 'semantic' | 'graph' = 'semantic',
) => ({
  documentId,
  title,
  content: '来源正文。',
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
      new AnswerCitationService().build('结论 [S2]，再次引用 [S2]。', [
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

  it.each([
    '没有标注来源的回答',
    '错误来源 [S9]',
    '混合来源 [S1] [S9]',
    '无效来源 [S01]',
  ])('never invents or partially accepts citations: %s', (answer) => {
    expect(
      new AnswerCitationService().build(answer, [item('doc-1', '第一篇')]),
    ).toEqual([]);
  });

  it('preserves graph as an explicit citation source type', () => {
    expect(
      new AnswerCitationService().build('关系见 [S1]', [
        item('doc-1', 'RAG 关系路径', 'graph'),
      ]),
    ).toMatchObject([{ sourceId: 'S1', sourceType: 'graph' }]);
  });

  it('exposes unique literal quotes only for the cited source', () => {
    const claims = [
      {
        text: '结论',
        evidence: [
          { sourceId: 'S1', quote: '来源正文。' },
          { sourceId: 'S1', quote: '来源正文。' },
          { sourceId: 'S1', quote: '虚构引句' },
          { sourceId: 'S2', quote: '来源正文。' },
        ],
      },
    ];
    expect(
      new AnswerCitationService().build(
        '结论 [S1]',
        [item('a', '甲'), item('b', '乙')],
        claims,
      ),
    ).toMatchObject([{ sourceId: 'S1', quotes: ['来源正文。'] }]);
  });
});
