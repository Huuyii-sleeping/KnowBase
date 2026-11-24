import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AnswerTelemetry,
  emitAnswerTelemetry,
  observeAsyncStage,
  observeSyncStage,
  withAnswerTelemetry,
} from './answer-telemetry';
import { TelemetryEvent } from './answer-telemetry.types';
import { invokeAnswerModel } from '../answer/chat-model-invocation';
import { AnswerFailure } from '../answer/answer-failure';
import { withModelPurpose } from './model-call-telemetry';

afterEach(() => vi.useRealTimers());
const setup = () => {
  const events: TelemetryEvent[] = [];
  const session = new AnswerTelemetry((event) =>
    events.push(structuredClone(event)),
  );
  return { session, events };
};

describe('per-answer telemetry', () => {
  it('isolates concurrent answers and preserves both normal results and original errors', async () => {
    const a = setup(),
      b = setup();
    const original = new Error('private details');
    await Promise.all([
      withAnswerTelemetry(a.session, async () => {
        expect(observeSyncStage('context.build', () => 42)).toBe(42);
        await observeAsyncStage('recall.keyword', async () => {
          await Promise.resolve();
        });
        a.session.finish({ status: 'success' });
      }),
      withAnswerTelemetry(b.session, async () => {
        await expect(
          observeAsyncStage('recall.semantic', async () => {
            throw original;
          }),
        ).rejects.toBe(original);
        b.session.finish({ status: 'error', errorCode: 'INTERNAL_ERROR' });
      }),
    ]);
    expect(new Set(a.events.map((e) => e.requestId))).toEqual(
      new Set([a.session.requestId]),
    );
    expect(new Set(b.events.map((e) => e.requestId))).toEqual(
      new Set([b.session.requestId]),
    );
    expect(a.session.requestId).not.toBe(b.session.requestId);
    expect(a.events.at(-1)).toMatchObject({
      status: 'success',
      stages: { 'context.build': { count: 1 } },
    });
    expect(b.events.at(-1)).toMatchObject({
      status: 'error',
      stages: { 'recall.semantic': { failures: 1 } },
    });
    expect(JSON.stringify(b.events)).not.toContain('private');
  });

  it('closes unfinished work once and suppresses late events and duplicate terminal results', async () => {
    const { session, events } = setup();
    let release!: () => void;
    const running = withAnswerTelemetry(session, () =>
      observeAsyncStage(
        'retrieval.total',
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      ),
    );
    session.finish({
      status: 'error',
      errorCode: 'ANSWER_TIMEOUT',
      stage: 'retrieval',
    });
    const count = events.length;
    release();
    await running;
    session.finish({ status: 'success' });
    expect(events).toHaveLength(count);
    expect(events.at(-1)).toMatchObject({
      stages: { 'retrieval.total': { interrupted: 1 } },
    });
  });

  it('accounts for every actual transport call, retry, citation repair and unknown usage', async () => {
    const { session, events } = setup();
    await withAnswerTelemetry(session, async () => {
      const invoke = vi
        .fn()
        .mockRejectedValueOnce({ status: 503 })
        .mockResolvedValue({
          content: 'answer',
          usage_metadata: {
            input_tokens: 12,
            output_tokens: 8,
            total_tokens: 20,
          },
        });
      expect(await invokeAnswerModel(invoke, 'test-model')).toBe('answer');
      emitAnswerTelemetry({ event: 'rag.answer.repair' });
      await withModelPurpose('citation_repair', () =>
        invokeAnswerModel(async () => ({ content: 'repaired' }), 'test-model'),
      );
      session.finish({ status: 'success' });
    });
    expect(events.at(-1)).toMatchObject({
      modelCalls: 3,
      transportRetries: 1,
      citationRepairs: 1,
      usage: {
        reportedInputTokens: 12,
        reportedOutputTokens: 8,
        reportedTotalTokens: 20,
        completeCalls: 1,
        unknownCalls: 2,
      },
    });
    expect(events.filter((e) => e.event === 'rag.answer.model')).toMatchObject([
      { outcome: 'error', errorCode: 'MODEL_UNAVAILABLE' },
      { outcome: 'completed' },
      { purpose: 'citation_repair', usage: { inputTokens: null } },
    ]);
  });

  it('keeps reported usage for rejected truncated output without retrying it', async () => {
    const { session, events } = setup();
    await withAnswerTelemetry(session, async () => {
      await expect(
        invokeAnswerModel(async () => ({
          content: 'prefix',
          response_metadata: { finish_reason: 'length' },
          usage_metadata: {
            input_tokens: 3,
            output_tokens: 4,
            total_tokens: 7,
          },
        })),
      ).rejects.toMatchObject({ code: 'MODEL_OUTPUT_LIMIT' });
      session.finish({ status: 'error', errorCode: 'MODEL_OUTPUT_LIMIT' });
    });
    expect(events.at(-1)).toMatchObject({
      modelCalls: 1,
      transportRetries: 0,
      usage: { reportedTotalTokens: 7 },
    });
    expect(events.find((e) => e.event === 'rag.answer.model')).toMatchObject({
      outcome: 'error',
      finishReason: 'length',
    });
  });

  it('counts a pending model call at total cancellation and never revises its terminal summary', async () => {
    const { session, events } = setup();
    let release!: (value: { content: string }) => void;
    const running = withAnswerTelemetry(session, () =>
      withModelPurpose('citation_repair', () =>
        invokeAnswerModel(
          () =>
            new Promise((resolve) => {
              release = resolve;
            }),
          'test-model',
        ),
      ),
    );
    session.finish({ status: 'error', errorCode: 'ANSWER_TIMEOUT' });
    expect(events.at(-1)).toMatchObject({
      modelCalls: 1,
      usage: { unknownCalls: 1 },
    });
    expect(events.find((e) => e.event === 'rag.answer.model')).toMatchObject({
      outcome: 'interrupted',
      purpose: 'citation_repair',
    });
    const count = events.length;
    release({ content: 'late' });
    await running;
    expect(events).toHaveLength(count);
  });

  it('never changes business behavior when a log sink throws or no request context exists', async () => {
    const session = new AnswerTelemetry(() => {
      throw new Error('log offline');
    });
    const original = new AnswerFailure('MODEL_CONFIGURATION_ERROR', 'private');
    await withAnswerTelemetry(session, async () => {
      expect(await observeAsyncStage('recall.keyword', async () => 'ok')).toBe(
        'ok',
      );
      expect(() =>
        observeSyncStage('context.build', () => {
          throw original;
        }),
      ).toThrow(original);
      session.finish({ status: 'error', errorCode: original.code });
    });
    expect(
      await observeAsyncStage('recall.keyword', async () => 'outside'),
    ).toBe('outside');
  });
});
