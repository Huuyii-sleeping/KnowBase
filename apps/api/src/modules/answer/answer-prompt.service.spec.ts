import { describe, expect, it } from 'vitest';
import { AnswerPromptService } from './answer-prompt.service';

describe('AnswerPromptService', () => {
  it('builds a Chinese grounded prompt with stable source labels', () => {
    const prompt = new AnswerPromptService().build('如何搜索？', [
      {
        documentId: 'doc-1',
        chunkId: 'chunk-1',
        chunkIndex: 2,
        title: '搜索指南',
        content: '使用混合检索。',
        category: null,
        team: null,
        tags: [],
        score: 0.9,
        keywordScore: 1,
        semanticScore: 0.8,
        sources: ['keyword', 'semantic'],
        rerankScore: 0.95,
      },
    ]);

    expect(prompt).toContain('问题：如何搜索？');
    expect(prompt).toContain('[S1] 文档：搜索指南，Chunk 2');
    expect(prompt).toContain('documentId=doc-1');
    expect(prompt).toContain('不要猜测或编造');
  });
});
