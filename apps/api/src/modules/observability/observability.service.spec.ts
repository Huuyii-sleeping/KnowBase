import { describe, expect, it, vi } from 'vitest';
import { AnswerFailure } from '../answer/answer-failure';
import { ObservabilityService } from './observability.service';

describe('ObservabilityService', () => {
  it('is a no-op when Langfuse is disabled', async () => {
    const service = new ObservabilityService({
      get: vi.fn().mockReturnValue(undefined),
    } as any);
    const context = service.startAnswerTrace('问题', 3);

    expect(context.trace).toBeUndefined();
    expect(() =>
      service.recordRetrieval(
        context,
        { query: '问题', topK: 3 },
        { itemCount: 0, items: [] },
        1,
      ),
    ).not.toThrow();
    expect(() =>
      service.completeAnswer(context, { answer: '拒答' }),
    ).not.toThrow();
    await expect(service.onModuleDestroy()).resolves.toBeUndefined();
  });
  it('records only safe failure categories locally even when Langfuse is disabled', () => {
    const service = new ObservabilityService({
      get: vi.fn().mockReturnValue(undefined),
    } as any);
    const warning = vi
      .spyOn((service as any).logger, 'warn')
      .mockImplementation(() => {});
    const context = service.startAnswerTrace('private question', 5);
    service.failAnswer(
      context,
      new AnswerFailure('MODEL_RATE_LIMITED', 'private error'),
      {
        stage: 'generation',
        modelCalls: 2,
        transportRetries: 1,
      },
    );
    expect(warning).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'rag.answer.failed',
        errorCode: 'MODEL_RATE_LIMITED',
        stage: 'generation',
        modelCalls: 2,
        transportRetries: 1,
      }),
    );
    expect(JSON.stringify(warning.mock.calls)).not.toContain('private');
  });
});
