import { describe, expect, it, vi } from 'vitest';
import { AnswerService } from './answer.service';
import { AnswerGroundingService } from './answer-grounding.service';
import { AnswerPromptService } from './answer-prompt.service';
import { AnswerCitationService } from './answer-citation.service';
import { HybridSearchItem } from '../search/hybrid-search.service';

const passage = (
  chunkId: string,
  content: string,
  rerankScore: number,
): HybridSearchItem => ({
  documentId: 'rules',
  chunkId,
  title: '培训资料规则',
  content,
  category: null,
  team: null,
  tags: [],
  score: 1,
  keywordScore: 1,
  semanticScore: null,
  sources: ['keyword'],
  rerankScore,
});

function setup(items: HybridSearchItem[], answer: string) {
  const chat = { generate: vi.fn().mockResolvedValue(answer) };
  const service = new AnswerService(
    { retrieve: vi.fn().mockResolvedValue({ items, graphUsed: false }) } as any,
    new AnswerPromptService(),
    chat,
    new AnswerCitationService(),
    new AnswerGroundingService(),
    {
      startAnswerTrace: vi.fn(),
      recordRetrieval: vi.fn(),
      recordGrounding: vi.fn(),
      recordGeneration: vi.fn(),
      completeAnswer: vi.fn(),
      failAnswer: vi.fn(),
    } as any,
  );
  return { service, chat };
}

describe('answer evidence flow', () => {
  it('passes both subfacts to generation and preserves each citation identity', async () => {
    const items = [
      passage('restore', '培训归档资料需管理员审批后恢复。', 0.9),
      passage('timeout', '培训在线预览超时为 30 秒。', 0.8),
    ];
    const { service, chat } = setup(
      items,
      '预览超时为 30 秒。[S2] 归档后需审批恢复。[S1]',
    );
    const result = await service.answer({
      question: '培训预览超时多久，归档后怎么恢复？',
      topK: 5,
    });
    const prompt = chat.generate.mock.calls[0][0];
    for (const item of items) expect(prompt).toContain(item.content);
    expect(prompt).toContain('[S1] 文档：培训资料规则');
    expect(result.contexts.map((x) => [x.sourceId, x.chunkId])).toEqual([
      ['S1', 'restore'],
      ['S2', 'timeout'],
    ]);
    expect(result.citations.map((x) => [x.sourceId, x.chunkId])).toEqual([
      ['S2', 'timeout'],
      ['S1', 'restore'],
    ]);
  });

  it('keeps an explicitly grouped multi-source answer with correct source identities', async () => {
    const { service } = setup(
      [
        passage('current', '培训现行上限为100人。', 0.9),
        passage('archive', '培训历史上限为20人。', 0.8),
      ],
      '培训上限从20人改为100人 [S1, S2]。',
    );
    const result = await service.answer({
      question: '培训新旧上限如何变化？',
      topK: 5,
    });
    expect(result.answer).toBe('培训上限从20人改为100人 [S1][S2]。');
    expect(result.citations.map((c) => [c.sourceId, c.chunkId])).toEqual([
      ['S1', 'current'],
      ['S2', 'archive'],
    ]);
  });

  it('keeps unsupported and empty contexts out of generation', async () => {
    const { service, chat } = setup(
      [
        passage('irrelevant', '培训采用线下签到。', 0.9),
        passage('empty', '', 0.8),
      ],
      '不应生成',
    );
    expect(
      await service.answer({ question: '火星表面温度是多少？', topK: 5 }),
    ).toMatchObject({
      answer: '知识库中没有找到足够信息',
      contexts: [],
      citations: [],
    });
    expect(chat.generate).not.toHaveBeenCalled();
  });

  it.each([
    '没有引用的事实',
    '事实 [S9]',
    '事实 [S1][S9]',
    '事实 [S1, S9]',
    '',
  ])(
    'does not invent or accept a source for invalid output: %s',
    async (answer) => {
      const { service } = setup(
        [passage('a', '培训预览规则需要审批。', 0.9)],
        answer,
      );
      expect(
        await service.answer({ question: '培训预览规则是什么？', topK: 5 }),
      ).toMatchObject({
        answer: '知识库中没有找到足够信息',
        contexts: [],
        citations: [],
      });
    },
  );

  it.each([
    '知识库中没有找到足够信息 [S1][S2]',
    '[S1] 知识库中没有找到足够信息。',
    '[S1] 知识库中没有找到足够信息 [S2]。',
    '知识库中没有找到足够信息 [S1, S2]。',
  ])(
    'does not expose contexts or citations for a marked refusal: %s',
    async (answer) => {
      const { service } = setup(
        [
          passage('a', '培训预览规则待定。', 0.9),
          passage('b', '培训归档规则待定。', 0.8),
        ],
        answer,
      );
      expect(
        await service.answer({
          question: '培训预览和归档有什么规则？',
          topK: 5,
        }),
      ).toMatchObject({
        answer: '知识库中没有找到足够信息',
        contexts: [],
        citations: [],
      });
    },
  );
});
