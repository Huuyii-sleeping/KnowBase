import { describe, expect, it, vi } from 'vitest';
import { AnswerGenerationService } from './answer-generation.service';
import { AnswerPromptService } from './answer-prompt.service';
import { ANSWER_REFUSAL } from './answer-citation-validation';
import { source, answerOutput, refusalOutput } from './answer.fixture';

const items = [source('a', '报销需要主管审批。')];
const output = answerOutput('需主管审批。', '报销需要主管审批。');
const prompts = new AnswerPromptService();

describe('AnswerGenerationService', () => {
  it('returns a validated answer with one model call', async () => {
    const model = { generate: vi.fn().mockResolvedValue(output) };
    const result = await new AnswerGenerationService(model, prompts).generate(
      'prompt',
      items,
    );
    expect(result.answer).toBe('需主管审批。 [S1]');
    expect(result.attempts).toHaveLength(1);
    expect(result.outcome).toBe('answered');
  });

  it('renders a citation for each separately validated claim', async () => {
    const model = {
      generate: vi.fn().mockResolvedValue(
        JSON.stringify({
          status: 'answered',
          claims: [
            {
              text: '需主管审批。',
              evidence: [{ sourceId: 'S1', quote: '报销需要主管审批。' }],
            },
            {
              text: '额度五千元。',
              evidence: [{ sourceId: 'S2', quote: '报销额度为五千元。' }],
            },
          ],
        }),
      ),
    };
    const result = await new AnswerGenerationService(model, prompts).generate(
      'prompt',
      [...items, source('b', '报销额度为五千元。')],
    );
    expect(result.answer).toBe('需主管审批。 [S1]\n额度五千元。 [S2]');
    expect(result.sourceIds).toEqual(['S1', 'S2']);
    expect(result.status).toBe('answered');
    expect(model.generate).toHaveBeenCalledTimes(1);
  });

  it('repairs missing citations once using the same evidence without fabricating S1', async () => {
    const model = {
      generate: vi
        .fn()
        .mockResolvedValueOnce('需主管审批。')
        .mockResolvedValueOnce(output),
    };
    const result = await new AnswerGenerationService(model, prompts).generate(
      'prompt',
      items,
    );
    expect(model.generate).toHaveBeenNthCalledWith(2, prompts.repair('prompt'));
    expect(result.sourceIds).toEqual(['S1']);
    expect(result.attempts).toHaveLength(2);
  });

  it('returns no answer evidence when both attempts have invalid provenance', async () => {
    const model = { generate: vi.fn().mockResolvedValue('伪结论 [S2]') };
    const result = await new AnswerGenerationService(model, prompts).generate(
      'prompt',
      items,
    );
    expect(model.generate).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      answer: ANSWER_REFUSAL,
      sourceIds: [],
      outcome: 'invalid-evidence',
    });
  });

  it('does not retry an explicit refusal', async () => {
    const model = { generate: vi.fn().mockResolvedValue(refusalOutput()) };
    const result = await new AnswerGenerationService(model, prompts).generate(
      'prompt',
      items,
    );
    expect(result.outcome).toBe('refusal');
    expect(model.generate).toHaveBeenCalledTimes(1);
  });

  it('keeps conflicts separate from missing information and never repairs a valid conflict', async () => {
    const model = {
      generate: vi.fn().mockResolvedValue(refusalOutput('conflict')),
    };
    const result = await new AnswerGenerationService(model, prompts).generate(
      'prompt',
      items,
    );
    expect(result).toMatchObject({
      status: 'conflict',
      outcome: 'conflict',
      answer: ANSWER_REFUSAL,
      sourceIds: [],
    });
    expect(model.generate).toHaveBeenCalledTimes(1);
  });

  it('repairs fabricated quotations even when source IDs exist', async () => {
    const model = {
      generate: vi
        .fn()
        .mockResolvedValueOnce(answerOutput('需审批。', '来源没有这句'))
        .mockResolvedValueOnce(output),
    };
    const result = await new AnswerGenerationService(model, prompts).generate(
      'prompt',
      items,
    );
    expect(result.status).toBe('answered');
    expect(result.attempts).toHaveLength(2);
  });

  it('propagates model transport failures rather than mislabelling them as knowledge refusal', async () => {
    const model = { generate: vi.fn().mockRejectedValue(new Error('offline')) };
    await expect(
      new AnswerGenerationService(model, prompts).generate('prompt', items),
    ).rejects.toThrow('offline');
    expect(model.generate).toHaveBeenCalledTimes(1);
  });
});
