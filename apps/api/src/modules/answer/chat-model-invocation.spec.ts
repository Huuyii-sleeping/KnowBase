import { afterEach, describe, expect, it, vi } from 'vitest';
import { invokeAnswerModel } from './chat-model-invocation';

afterEach(() => vi.useRealTimers());

describe('shared answer model invocation', () => {
  it('keeps only text from supported response content blocks', async () => {
    expect(
      await invokeAnswerModel(async () => ({
        content: [
          { type: 'text', text: '答案' },
          { type: 'reasoning', reasoning: 'hidden' },
          ' [S1]',
        ],
        response_metadata: { finish_reason: 'stop' },
      })),
    ).toBe('答案 [S1]');
  });
  it.each([null, '', ' ', { answer: 'must not stringify' }])(
    'rejects unusable content: %j',
    async (content) => {
      await expect(
        invokeAnswerModel(async () => ({ content })),
      ).rejects.toThrow('empty answer');
    },
  );
  it('enforces the deadline and clears timers even if transport ignores cancellation', async () => {
    vi.useFakeTimers();
    const invoke = vi.fn(
      (_signal: AbortSignal) => new Promise<never>(() => {}),
    );
    const checked = expect(invokeAnswerModel(invoke)).rejects.toThrow(
      'timed out',
    );
    await vi.advanceTimersByTimeAsync(30000);
    await checked;
    expect(invoke.mock.calls[0][0].aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('clears the timer when the transport fails', async () => {
    vi.useFakeTimers();
    await expect(
      invokeAnswerModel(async () => {
        throw new Error('offline');
      }),
    ).rejects.toThrow('offline');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('rejects even valid-looking JSON when the provider reports truncation', async () => {
    vi.useFakeTimers();
    await expect(
      invokeAnswerModel(async () => ({
        content: '{"status":"answered","claims":[]}',
        response_metadata: { finish_reason: 'length' },
      })),
    ).rejects.toThrow('exceeded its budget');
    expect(vi.getTimerCount()).toBe(0);
  });
});
