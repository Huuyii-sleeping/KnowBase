import { describe, expect, it, vi } from 'vitest';
import { AnswerService } from './answer.service';
import { AnswerContextService } from './answer-context.service';
import { AnswerPromptService } from './answer-prompt.service';
import { AnswerGenerationService } from './answer-generation.service';
import { AnswerCitationService } from './answer-citation.service';
import { ANSWER_REFUSAL } from './answer-citation-validation';
import { source, answerOutput, refusalOutput } from './answer.fixture';

function setup(
  items = [source('a', '允许远程办公。')],
  outputs = [answerOutput('可以居家履职。', '允许远程办公。')],
) {
  const retrieval = {
    retrieve: vi.fn().mockResolvedValue({ items, graphUsed: false }),
  };
  const model = { modelName: 'active-test-model', generate: vi.fn() };
  for (const output of outputs) model.generate.mockResolvedValueOnce(output);
  const prompt = new AnswerPromptService();
  const observability = {
    startAnswerTrace: vi.fn().mockReturnValue({ startedAt: Date.now() }),
    recordRetrieval: vi.fn(),
    recordGrounding: vi.fn(),
    recordGeneration: vi.fn(),
    completeAnswer: vi.fn(),
    failAnswer: vi.fn(),
  };
  const service = new AnswerService(
    retrieval as any,
    new AnswerContextService(prompt),
    new AnswerGenerationService(model, prompt),
    new AnswerCitationService(),
    observability as any,
  );
  return { service, model, retrieval, observability };
}

describe('AnswerService evidence consumption', () => {
  it('consumes admitted context through the real assembly, generation and citation services', async () => {
    const { service, model, retrieval, observability } = setup();
    const user = { id: 'u', role: 'MEMBER' as const, team: 't' };
    expect(
      await service.answer(
        { question: '  远程办公是否允许？ ', topK: 5 },
        user,
      ),
    ).toMatchObject({
      question: '远程办公是否允许？',
      answer: '可以居家履职。 [S1]',
      citations: [{ sourceId: 'S1', documentId: 'doc-a' }],
      contexts: [{ sourceId: 'S1', documentId: 'doc-a' }],
    });
    expect(retrieval.retrieve).toHaveBeenCalledWith(
      '远程办公是否允许？',
      5,
      user,
    );
    expect(model.generate.mock.calls[0][0]).toContain('允许远程办公。');
    expect(observability.recordGeneration).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ model: 'active-test-model' }),
      answerOutput('可以居家履职。', '允许远程办公。'),
      expect.any(Number),
    );
  });

  it('consumes complementary blocks and returns source IDs exactly as used in the prompt', async () => {
    const items = [
      source('a', '申请须经主管审批。'),
      source('b', '申请额度为五千元。'),
    ];
    const { service } = setup(items, [
      JSON.stringify({
        status: 'answered',
        claims: [
          {
            text: '需要审批。',
            evidence: [{ sourceId: 'S1', quote: '申请须经主管审批。' }],
          },
          {
            text: '额度五千元。',
            evidence: [{ sourceId: 'S2', quote: '申请额度为五千元。' }],
          },
        ],
      }),
    ]);
    const result = await service.answer({
      question: '申请审批流程和申请额度规定是什么？',
      topK: 5,
    });
    expect(result.contexts.map((item) => item.documentId)).toEqual([
      'doc-a',
      'doc-b',
    ]);
    expect(result.citations.map((item) => item.sourceId)).toEqual(['S1', 'S2']);
    expect(result.answer).toContain('额度五千元。 [S2]');
  });

  it('does not call the model when there is no usable context', async () => {
    const { service, model } = setup([source('a', '  ')]);
    expect(
      await service.answer({ question: '远程办公是否允许？', topK: 5 }),
    ).toMatchObject({
      answer: ANSWER_REFUSAL,
      citations: [],
      contexts: [],
    });
    expect(model.generate).not.toHaveBeenCalled();
  });

  it('returns separate source identities and original ranges for excerpts of the same chunk', async () => {
    const content =
      '# 背景\n' +
      '背景。'.repeat(4000) +
      '\n# 预约材料\n预约须有回执。\n# 无关章节\n其他信息。\n# 预约附加材料\n预约还须交接表。';
    const item = source('a', content);
    const { service } = setup(
      [item],
      [
        JSON.stringify({
          status: 'answered',
          claims: [
            {
              text: '需要回执和交接表。',
              evidence: [
                { sourceId: 'S1', quote: '预约须有回执。' },
                { sourceId: 'S2', quote: '预约还须交接表。' },
              ],
            },
          ],
        }),
      ],
    );
    const result = await service.answer({
      question: '预约材料需要什么？',
      topK: 5,
    });
    expect(result.status).toBe('answered');
    expect(result.citations.map((citation) => citation.sourceId)).toEqual([
      'S1',
      'S2',
    ]);
    expect(result.citations.map((citation) => citation.chunkId)).toEqual([
      'chunk-a',
      'chunk-a',
    ]);
    for (const [index, context] of result.contexts.entries()) {
      expect(context.contentRange).toBeDefined();
      const { start, end } = context.contentRange!;
      expect(content.slice(start, end)).toBe(context.content);
      expect(result.citations[index].contentRange).toEqual(
        context.contentRange,
      );
      expect(context.content).toContain(result.citations[index].quotes![0]);
    }
  });

  it('rejects a quote stitched across separate excerpts even when both belong to one chunk', async () => {
    const item = source(
      'a',
      '# 背景\n' +
        '背景。'.repeat(4000) +
        '\n# 预约材料\n预约须有回执。\n# 预约附加材料\n预约还须交接表。',
    );
    const { service } = setup(
      [item],
      [
        answerOutput('需要材料。', '预约须有回执。预约还须交接表。'),
        answerOutput('需要材料。', '预约须有回执。预约还须交接表。'),
      ],
    );
    expect(
      await service.answer({ question: '预约材料', topK: 5 }),
    ).toMatchObject({ status: 'insufficient', citations: [], contexts: [] });
  });

  it('lets the model reject unrelated recovered context and records the selection policy', async () => {
    const { service, model, observability } = setup(
      [source('a', '报销需要主管审批。')],
      [refusalOutput()],
    );
    expect(
      await service.answer({ question: '火星上可以办公吗？', topK: 5 }),
    ).toMatchObject({
      answer: ANSWER_REFUSAL,
      citations: [],
      contexts: [],
    });
    expect(model.generate).toHaveBeenCalledTimes(1);
    expect(observability.recordGrounding).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ selectionPolicy: 'upstream-ranked' }),
      expect.any(Number),
    );
  });

  it('refuses after one unsuccessful repair and records why rather than inventing citations', async () => {
    const { service, model, observability } = setup(undefined, [
      '没有引用。',
      '仍然没有引用。',
    ]);
    expect(
      await service.answer({ question: '远程办公是否允许？', topK: 5 }),
    ).toMatchObject({
      answer: ANSWER_REFUSAL,
      citations: [],
      contexts: [],
    });
    expect(model.generate).toHaveBeenCalledTimes(2);
    expect(observability.recordGeneration).toHaveBeenCalledTimes(2);
    expect(observability.completeAnswer).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ outcome: 'invalid-evidence' }),
    );
  });

  it('exposes conflict status without treating it as a successful cited answer', async () => {
    const { service, observability } = setup(undefined, [
      refusalOutput('conflict'),
    ]);
    expect(
      await service.answer({ question: '采用哪个规则？', topK: 5 }),
    ).toMatchObject({
      status: 'conflict',
      answer: ANSWER_REFUSAL,
      citations: [],
      contexts: [],
    });
    expect(observability.completeAnswer).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ status: 'refusal', outcome: 'conflict' }),
    );
  });

  it('reports retrieval failures and does not call the model', async () => {
    const { service, model, retrieval, observability } = setup();
    retrieval.retrieve.mockRejectedValue(new Error('retrieval failed'));
    await expect(
      service.answer({ question: '远程办公是否允许？', topK: 5 }),
    ).rejects.toThrow('retrieval failed');
    expect(model.generate).not.toHaveBeenCalled();
    expect(observability.failAnswer).toHaveBeenCalled();
  });
});
