import { describe, expect, it, vi } from 'vitest';
import { ObservabilityService } from './observability.service';

describe('ObservabilityService', () => {
  it('is a no-op when Langfuse is disabled', async () => {
    const service = new ObservabilityService({
      get: vi.fn().mockReturnValue(undefined),
    } as any);
    const context = service.startAnswerTrace('问题', 3);

    expect(context.trace).toBeUndefined();
    expect(() => service.recordRetrieval(
      context,
      { query: '问题', topK: 3 },
      { itemCount: 0, items: [] },
      1,
    )).not.toThrow();
    expect(() => service.completeAnswer(context, { answer: '拒答' })).not.toThrow();
    await expect(service.onModuleDestroy()).resolves.toBeUndefined();
  });
});
