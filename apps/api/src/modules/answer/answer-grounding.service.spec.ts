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
      item('RAG 是检索增强生成。'),
    ])).toBe(true);
  });

  it('rejects unrelated questions despite a semantic candidate', () => {
    expect(new AnswerGroundingService().hasLexicalSupport('公司是否允许在火星办公？', [
      item('RAG 是检索增强生成。'),
    ])).toBe(false);
  });
});
