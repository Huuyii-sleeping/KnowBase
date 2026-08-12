import { describe, expect, it, vi } from 'vitest';
import { AnswerService } from './answer.service';

const observability = {
  startAnswerTrace: vi.fn().mockReturnValue({ startedAt: Date.now() }),
  recordRetrieval: vi.fn(),
  recordGrounding: vi.fn(),
  recordGeneration: vi.fn(),
  completeAnswer: vi.fn(),
  failAnswer: vi.fn(),
};

describe('AnswerService', () => {
  it('retrieves context, generates a grounded answer, and returns citations', async () => {
    const hybridSearch = {
      search: vi.fn().mockResolvedValue({
        query: '如何搜索？',
        topK: 2,
        items: [{
          documentId: 'doc-1',
          chunkId: 'chunk-1',
          chunkIndex: 0,
          title: '搜索指南',
          content: '使用混合检索。',
          category: null,
          team: null,
          tags: [],
          score: 0.8,
          keywordScore: 1,
          semanticScore: 0.8,
          sources: ['keyword', 'semantic'],
          rerankScore: 0.9,
        }],
      }),
    };
    const prompt = { build: vi.fn().mockReturnValue('prompt') };
    const chatModel = { generate: vi.fn().mockResolvedValue('可以使用混合检索。[S1]') };
    const citations = { build: vi.fn().mockReturnValue([{
      sourceId: 'S1',
      documentId: 'doc-1',
      title: '搜索指南',
      score: 0.9,
    }]) };

    const service = new AnswerService(
      hybridSearch as any,
      prompt as any,
      chatModel as any,
      citations as any,
      {
        selectSupportedItems: vi.fn().mockReturnValue([{
          documentId: 'doc-1',
          chunkId: 'chunk-1',
          chunkIndex: 0,
          title: '搜索指南',
          content: '使用混合检索。',
          category: null,
          team: null,
          tags: [],
          score: 0.8,
          keywordScore: 1,
          semanticScore: 0.8,
          sources: ['keyword', 'semantic'],
          rerankScore: 0.9,
        }]),
      } as any,
      observability as any,
    );
    await expect(service.answer({ question: '  如何搜索？ ', topK: 2 })).resolves.toMatchObject({
      question: '如何搜索？',
      answer: '可以使用混合检索。[S1]',
      citations: [{ sourceId: 'S1' }],
      contexts: [{ sourceId: 'S1', documentId: 'doc-1' }],
    });
    expect(prompt.build).toHaveBeenCalledWith('如何搜索？', expect.any(Array));
    expect(chatModel.generate).toHaveBeenCalledWith('prompt');
  });

  it('does not call the model when no context is returned', async () => {
    const service = new AnswerService(
      { search: vi.fn().mockResolvedValue({ items: [] }) } as any,
      { build: vi.fn().mockReturnValue([]) } as any,
      { generate: vi.fn() } as any,
      { build: vi.fn().mockReturnValue([]) } as any,
      { selectSupportedItems: vi.fn().mockReturnValue([]) } as any,
      observability as any,
    );

    await expect(service.answer({ question: '问题', topK: 1 })).resolves.toMatchObject({
      answer: '知识库中没有找到足够信息',
      citations: [],
      contexts: [],
    });
  });

  it('returns no citation or context for an unsupported question', async () => {
    const search = { search: vi.fn().mockResolvedValue({ items: [{
      documentId: 'doc-1',
      title: 'RAG 基础',
      content: 'RAG 是检索增强生成。',
      category: null,
      team: null,
      tags: [],
      score: 0.8,
      keywordScore: null,
      semanticScore: 0.8,
      sources: ['semantic'],
      rerankScore: 0.8,
    }] }) };
    const chatModel = { generate: vi.fn() };
    const service = new AnswerService(
      search as any,
      { build: vi.fn().mockReturnValue([]) } as any,
      chatModel as any,
      { build: vi.fn().mockReturnValue([]) } as any,
      { selectSupportedItems: vi.fn().mockReturnValue([]) } as any,
      observability as any,
    );

    await expect(service.answer({ question: '公司是否允许在火星办公？', topK: 1 })).resolves.toMatchObject({
      answer: '知识库中没有找到足够信息',
      citations: [],
      contexts: [],
    });
    expect(chatModel.generate).not.toHaveBeenCalled();
  });

  it('clears citations when the model explicitly refuses', async () => {
    const item = {
      documentId: 'doc-1',
      title: '搜索指南',
      content: '上下文不足。',
      category: null,
      team: null,
      tags: [],
      score: 0.8,
      keywordScore: null,
      semanticScore: 0.8,
      sources: ['semantic'],
      rerankScore: 0.8,
    };
    const service = new AnswerService(
      { search: vi.fn().mockResolvedValue({ items: [item] }) } as any,
      { build: vi.fn().mockReturnValue('prompt') } as any,
      { generate: vi.fn().mockResolvedValue('知识库中没有找到足够信息 [S1]') } as any,
      { build: vi.fn() } as any,
      { selectSupportedItems: vi.fn().mockReturnValue([item]) } as any,
      observability as any,
    );

    await expect(service.answer({ question: '问题', topK: 1 })).resolves.toMatchObject({
      answer: '知识库中没有找到足够信息',
      citations: [],
      contexts: [],
    });
  });
});
