import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkAnswerDeadline,
  currentAnswerExecution,
  runWithAnswerDeadline,
} from './answer-execution';

afterEach(() => vi.useRealTimers());

describe('whole answer deadline', () => {
  it('cleans up after success and failure and never leaks execution into other requests', async () => {
    vi.useFakeTimers();
    await expect(
      runWithAnswerDeadline(async () => {
        expect(currentAnswerExecution()).toBeDefined();
        return 'ok';
      }),
    ).resolves.toBe('ok');
    await expect(
      runWithAnswerDeadline(async () => {
        throw new Error('failed');
      }),
    ).rejects.toThrow('failed');
    expect(currentAnswerExecution()).toBeUndefined();
    expect(() => checkAnswerDeadline()).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('returns by the total deadline even when retrieval ignores cancellation; late work cannot proceed', async () => {
    vi.useFakeTimers();
    let resume!: () => void;
    let signal!: AbortSignal;
    const laterStage = vi.fn();
    const checked = expect(
      runWithAnswerDeadline(async (execution) => {
        signal = execution.signal;
        await new Promise<void>((resolve) => {
          resume = resolve;
        });
        checkAnswerDeadline();
        laterStage();
      }),
    ).rejects.toMatchObject({ code: 'ANSWER_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(45000);
    await checked;
    expect(signal.aborted).toBe(true);
    resume();
    await vi.advanceTimersByTimeAsync(1);
    expect(laterStage).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('isolates parallel request recovery allowances', async () => {
    const seen = await Promise.all(
      [true, false].map((used) =>
        runWithAnswerDeadline(async (execution) => {
          execution.transportRetryUsed = used;
          await Promise.resolve();
          expect(currentAnswerExecution()).toBe(execution);
          return currentAnswerExecution()?.transportRetryUsed;
        }),
      ),
    );
    expect(seen).toEqual([true, false]);
  });
});
