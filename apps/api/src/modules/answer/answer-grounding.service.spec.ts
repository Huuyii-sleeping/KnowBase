import { describe, expect, it } from 'vitest';
import { AnswerGroundingService } from './answer-grounding.service';

const item = (content: string) => ({
  documentId: 'doc-1',
  title: 'RAG 基础',
  content,
  category: null,
  team: null,
  tags: [],
  score: 0.8,
  keywordScore: null,
  semanticScore: 0.8,
  sources: ['semantic'] as const,
  rerankScore: 0.8,
});

describe('AnswerGroundingService', () => {
  it('accepts questions supported by retrieved context', () => {
    expect(new AnswerGroundingService().hasLexicalSupport('RAG 的基本流程是什么？', [
      item('RAG 的基本流程是检索增强生成。'),
    ])).toBe(true);
  });

  it('rejects unrelated questions despite a semantic candidate', () => {
    expect(new AnswerGroundingService().hasLexicalSupport('公司是否允许在火星办公？', [
      item('RAG 是检索增强生成。'),
    ])).toBe(false);
  });

  it('selects supported contexts and limits noisy candidates', () => {
    const service = new AnswerGroundingService();
    const selected = service.selectSupportedItems('embedding 的作用是什么？', [
      item('无关的 top-k 和延迟说明。'),
      item('embedding 的作用是把文本映射到向量空间，支持语义检索。'),
      item('embedding 也可以用于文档向量化。'),
    ], 1);

    expect(selected).toHaveLength(1);
    expect(selected.every((candidate) => candidate.content?.includes('embedding'))).toBe(true);
  });

  it('keeps different required subfacts instead of discarding all but the first passage', () => {
    const first = { ...item('超时后先查实际审批状态，不要立即重复申请。'), chunkId: 'c0' };
    const second = { ...item('归档恢复后核对审批结论、附件引用和权限。'), chunkId: 'c3', rerankScore: 0.7 };
    const selected = new AnswerGroundingService().selectSupportedItems(
      '申请超时怎么办，归档恢复后核对什么？', [first, second],
    );
    expect(selected).toEqual([first, second]);
  });

  it('retains current and archived sources for comparisons with stable model order', () => {
    const current = { ...item('现行上传上限为100MiB。'), documentId: 'current', chunkId: 'c0' };
    const archive = { ...item('历史上传上限为20MiB。'), documentId: 'archive', chunkId: 'c0', rerankScore: 0.6 };
    expect(new AnswerGroundingService().selectSupportedItems('新旧上传上限有什么变化？', [current, archive]))
      .toEqual([current, archive]);
  });
});
