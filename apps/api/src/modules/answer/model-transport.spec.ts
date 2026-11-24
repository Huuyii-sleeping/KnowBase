import { afterEach, describe, expect, it, vi } from 'vitest';
import { invokeAnswerModel } from './chat-model-invocation';
import { runWithAnswerDeadline } from './answer-execution';
import { AnswerGenerationService } from './answer-generation.service';
import { AnswerPromptService } from './answer-prompt.service';
import { source } from './answer.fixture';

afterEach(() => vi.useRealTimers());
const ok = { content: 'answer' };

describe('bounded model transport recovery', () => {
  it('recovers a transient failure once and records its real invocation count', async () => {
    const invoke = vi
      .fn()
      .mockRejectedValueOnce({ status: 503 })
      .mockResolvedValue(ok);
    await runWithAnswerDeadline(async (execution) => {
      expect(await invokeAnswerModel(invoke)).toBe('answer');
      expect(execution).toMatchObject({
        modelCalls: 2,
        transportRetries: 1,
        lastFailureCode: 'MODEL_UNAVAILABLE',
      });
    });
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('never spends a second recovery allowance on citation repair', async () => {
    const invoke = vi
      .fn()
      .mockRejectedValueOnce({ status: 503 })
      .mockResolvedValueOnce({ content: 'missing structured evidence' })
      .mockRejectedValue({ status: 503 });
    const generation = new AnswerGenerationService(
      { generate: () => invokeAnswerModel(invoke) },
      new AnswerPromptService(),
    );
    await expect(
      runWithAnswerDeadline(() =>
        generation.generate('prompt', [source('a', 'body')]),
      ),
    ).rejects.toMatchObject({ code: 'MODEL_UNAVAILABLE' });
    expect(invoke).toHaveBeenCalledTimes(3);
  });

  it.each([401, 500, 504])(
    'does not automatically repeat status %s',
    async (status) => {
      const invoke = vi.fn().mockRejectedValue({ status });
      await expect(invokeAnswerModel(invoke)).rejects.toHaveProperty('code');
      expect(invoke).toHaveBeenCalledTimes(1);
    },
  );

  it('respects a long Retry-After without sleeping or retrying', async () => {
    const invoke = vi.fn().mockRejectedValue({
      status: 429,
      headers: new Headers({ 'retry-after': '60' }),
    });
    await expect(invokeAnswerModel(invoke)).rejects.toMatchObject({
      code: 'MODEL_RATE_LIMITED',
      retryAfterMs: 60000,
    });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('honors Retry-After on service unavailability as well as rate limiting', async () => {
    const invoke = vi
      .fn()
      .mockRejectedValue({ status: 503, headers: { 'retry-after': '60' } });
    await expect(invokeAnswerModel(invoke)).rejects.toMatchObject({
      code: 'MODEL_UNAVAILABLE',
      retryAfterMs: 60000,
    });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('waits at least the requested short Retry-After', async () => {
    const invoke = vi
      .fn()
      .mockRejectedValueOnce({
        status: 429,
        headers: { 'retry-after': '0.05' },
      })
      .mockResolvedValue(ok);
    const started = performance.now();
    expect(await invokeAnswerModel(invoke)).toBe('answer');
    expect(performance.now() - started).toBeGreaterThanOrEqual(45);
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('does not repair or retry truncated or empty content', async () => {
    for (const response of [
      { content: '' },
      { content: 'prefix', response_metadata: { finish_reason: 'length' } },
    ]) {
      const invoke = vi.fn().mockResolvedValue(response);
      await expect(invokeAnswerModel(invoke)).rejects.toHaveProperty('code');
      expect(invoke).toHaveBeenCalledTimes(1);
    }
  });

  it('does not start recovery when less than five seconds remain', async () => {
    vi.useFakeTimers();
    const invoke = vi.fn().mockRejectedValue({ status: 503 });
    const checked = expect(
      runWithAnswerDeadline(async () => {
        await new Promise((resolve) => setTimeout(resolve, 41000));
        return invokeAnswerModel(invoke);
      }),
    ).rejects.toMatchObject({ code: 'MODEL_UNAVAILABLE' });
    await vi.advanceTimersByTimeAsync(41000);
    await checked;
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('shares the total deadline with a second model call that ignores abort', async () => {
    vi.useFakeTimers();
    let signal!: AbortSignal;
    const checked = expect(
      runWithAnswerDeadline(async () => {
        await invokeAnswerModel(async () => {
          await new Promise((resolve) => setTimeout(resolve, 25000));
          return { content: 'first output' };
        });
        return invokeAnswerModel((received) => {
          signal = received;
          return new Promise(() => {});
        });
      }),
    ).rejects.toMatchObject({ code: 'ANSWER_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(45000);
    await checked;
    expect(signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('never retries a 30 second model timeout', async () => {
    vi.useFakeTimers();
    const invoke = vi.fn(() => new Promise<never>(() => {}));
    const checked = expect(
      runWithAnswerDeadline(() => invokeAnswerModel(invoke)),
    ).rejects.toMatchObject({ code: 'MODEL_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(30000);
    await checked;
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
