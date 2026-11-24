import { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BgeHttpService } from './bge-http.service';
import { HybridRerankService } from './hybrid-rerank.service';
import { RerankService } from './rerank.service';
import { candidate } from './bge.fixture';
import { AnswerContextService } from '../../answer/answer-context.service';
import { AnswerPromptService } from '../../answer/answer-prompt.service';
import { BgeFailure } from './bge-failure';
import {
  AnswerTelemetry,
  withAnswerTelemetry,
} from '../../observability/answer-telemetry';
import { TelemetryEvent } from '../../observability/answer-telemetry.types';

describe('HybridRerankService', () => {
  afterEach(() => vi.restoreAllMocks());

  const make = (mode = 'bge') => {
    const rule = new RerankService();
    const model = new BgeHttpService(new ConfigService({ RAG_RERANKER: mode }));
    const score = vi.spyOn(model, 'score');
    return { rule, score, service: new HybridRerankService(rule, model) };
  };

  it('default rule mode is byte-for-byte baseline and makes no model request', async () => {
    const { rule, score, service } = make('rule');
    const pool = [candidate('a'), candidate('b')];
    expect(await service.rerank('证据', pool, { topK: 5 })).toEqual(
      rule.rerank('证据', pool, { topK: 5 }),
    );
    expect(score).not.toHaveBeenCalled();
  });

  it('awaits model scoring, preserves identity/body, and the grounding consumer retains model order', async () => {
    const { score, service } = make();
    const pool = [candidate('a', 3), candidate('b', 2), candidate('c', 1)];
    score.mockResolvedValue(
      new Map([
        ['a', -3],
        ['b', -2],
        ['c', -1],
      ]),
    );
    const result = await service.rerank('正文证据', pool, { topK: 3 });
    expect(result.map((x) => x.chunkId)).toEqual(['c', 'b', 'a']);
    expect(
      new AnswerContextService(new AnswerPromptService()).build(
        '正文证据',
        result,
      ).items[0].chunkId,
    ).toBe('c');
    expect(score).toHaveBeenCalledWith('正文证据', pool);
  });

  it('returns the complete baseline on failure, skips during cooldown, then recovers', async () => {
    const { score, rule, service } = make();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
    const pool = [candidate('a', 2), candidate('b', 1)];
    score.mockRejectedValueOnce(new Error('private text must not be logged'));
    const baseline = rule.rerank('证据', pool, { topK: 2 });
    expect(await service.rerank('证据', pool, { topK: 2 })).toEqual(baseline);
    clock.mockReturnValue(2000);
    expect(await service.rerank('证据', pool, { topK: 2 })).toEqual(baseline);
    expect(score).toHaveBeenCalledTimes(1);
    clock.mockReturnValue(31001);
    score.mockResolvedValue(
      new Map([
        ['a', 1],
        ['b', 2],
      ]),
    );
    expect((await service.rerank('证据', pool, { topK: 2 }))[0].chunkId).toBe(
      'b',
    );
    expect(score).toHaveBeenCalledTimes(2);
  });

  it('bypasses concurrent inference and never queues more than one model request', async () => {
    const { score, rule, service } = make();
    const pool = [candidate('a')];
    let finish!: (scores: Map<string, number>) => void;
    score.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const first = service.rerank('证据', pool, { topK: 1 });
    expect(await service.rerank('证据', pool, { topK: 1 })).toEqual(
      rule.rerank('证据', pool, { topK: 1 }),
    );
    expect(score).toHaveBeenCalledTimes(1);
    finish(new Map([['a', 9]]));
    expect((await first)[0].rerankScore).toBe(0.5);
    score.mockResolvedValue(new Map([['a', 8]]));
    expect(
      (await service.rerank('证据', pool, { topK: 1 }))[0].rerankScore,
    ).toBe(0.5);
  });

  it('does not invent scores for incomplete responses and bypasses unsupported inputs', async () => {
    const { score, rule, service } = make();
    const pool = [candidate('a')];
    score.mockResolvedValue(new Map());
    expect(await service.rerank('证据', pool, { topK: 1 })).toEqual(
      rule.rerank('证据', pool, { topK: 1 }),
    );
    const next = make();
    for (const items of [
      [],
      [candidate('a'), candidate('a')],
      [{ ...candidate('a'), chunkId: undefined }],
    ]) {
      await next.service.rerank('证据', items, { topK: 5 });
    }
    expect(next.score).not.toHaveBeenCalled();
  });

  it('records successful BGE and every bypass separately while retaining exact rule results', async () => {
    const events: TelemetryEvent[] = [];
    const session = new AnswerTelemetry((e) => events.push(e));
    const f = make();
    const pool = [candidate('a')];
    await withAnswerTelemetry(session, async () => {
      await make('rule').service.rerank('证据', pool, { topK: 1 });
      await f.service.rerank('证据', [], { topK: 1 });
      await f.service.rerank('证据', [candidate('a'), candidate('a')], {
        topK: 1,
      });
      let release!: (value: Map<string, number>) => void;
      f.score.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      );
      const first = f.service.rerank('证据', pool, { topK: 1 });
      expect(await f.service.rerank('证据', pool, { topK: 1 })).toEqual(
        f.rule.rerank('证据', pool, { topK: 1 }),
      );
      release(new Map([['a', 1]]));
      await first;
      f.score.mockRejectedValueOnce(new BgeFailure('runtime_busy'));
      await f.service.rerank('证据', pool, { topK: 1 });
      await f.service.rerank('证据', pool, { topK: 1 });
      session.finish({ status: 'success' });
    });
    expect(
      events
        .filter((e) => e.event === 'rag.answer.rerank')
        .map((e) => e.reason),
    ).toEqual([
      'configured_rule',
      'empty_pool',
      'unsupported_input',
      'api_busy',
      'model_selected',
      'runtime_busy',
      'cooldown',
    ]);
    expect(f.score).toHaveBeenCalledTimes(2);
  });

  it.each([
    'timeout',
    'unavailable',
    'invalid_response',
    'request_too_large',
  ] as const)(
    'records %s failures without altering baseline selection',
    async (reason) => {
      const events: TelemetryEvent[] = [];
      const session = new AnswerTelemetry((e) => events.push(e));
      const f = make();
      const pool = [candidate('a')];
      f.score.mockRejectedValue(new BgeFailure(reason));
      expect(
        await withAnswerTelemetry(session, () =>
          f.service.rerank('证据', pool, { topK: 1 }),
        ),
      ).toEqual(f.rule.rerank('证据', pool, { topK: 1 }));
      expect(events.find((e) => e.event === 'rag.answer.rerank')).toMatchObject(
        { path: 'rule', reason },
      );
    },
  );
});
