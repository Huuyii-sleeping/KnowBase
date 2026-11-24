import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { ObservabilityService } from './observability.service';
import { AnswerService } from '../answer/answer.service';
import { AnswerRetrievalService } from '../answer/answer-retrieval.service';
import { GraphIntentService } from '../answer/graph-intent.service';
import { AnswerContextService } from '../answer/answer-context.service';
import { AnswerGenerationService } from '../answer/answer-generation.service';
import { AnswerPromptService } from '../answer/answer-prompt.service';
import { AnswerCitationService } from '../answer/answer-citation.service';
import { answerOutput } from '../answer/answer.fixture';
import { invokeAnswerModel } from '../answer/chat-model-invocation';
import { HybridSearchService } from '../search/hybrid-search.service';
import { RagQueryService } from '../rag/rag-query.service';
import { HybridRerankService } from '../retrieval/rerank/hybrid-rerank.service';
import { RerankService } from '../retrieval/rerank/rerank.service';
import { BgeHttpService } from '../retrieval/rerank/bge-http.service';
import { BgeFailure } from '../retrieval/rerank/bge-failure';

const sdk = vi.hoisted(() => ({
  construct: vi.fn(),
  trace: vi.fn(),
  span: vi.fn(),
  generation: vi.fn(),
  event: vi.fn(),
  end: vi.fn(),
  updateObservation: vi.fn(),
  updateTrace: vi.fn(),
  flush: vi.fn(),
  shutdown: vi.fn(),
}));
vi.mock('langfuse', () => ({
  Langfuse: class {
    constructor() {
      return sdk.construct();
    }
  },
}));

beforeEach(() => {
  vi.resetAllMocks();
  const observation = { end: sdk.end, update: sdk.updateObservation };
  sdk.span.mockReturnValue(observation);
  sdk.generation.mockReturnValue(observation);
  sdk.trace.mockReturnValue({
    span: sdk.span,
    generation: sdk.generation,
    event: sdk.event,
    update: sdk.updateTrace,
  });
  sdk.construct.mockReturnValue({
    trace: sdk.trace,
    flushAsync: sdk.flush,
    shutdownAsync: sdk.shutdown,
  });
  sdk.flush.mockResolvedValue(undefined);
  sdk.shutdown.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function fixture(enabled = false) {
  const service = new ObservabilityService(
    new ConfigService(
      enabled
        ? {
            LANGFUSE_ENABLED: 'true',
            LANGFUSE_PUBLIC_KEY: 'test-public',
            LANGFUSE_SECRET_KEY: 'test-secret',
          }
        : {},
    ),
  );
  const logs: any[] = [];
  const log = vi
    .spyOn((service as any).logger, 'log')
    .mockImplementation((line: any) => {
      logs.push(JSON.parse(line));
    });
  vi.spyOn((service as any).logger, 'warn').mockImplementation((line: any) => {
    if (typeof line === 'string' && line.startsWith('{'))
      logs.push(JSON.parse(line));
  });
  const body = '申请需要主管审批。';
  const bge = new BgeHttpService(new ConfigService());
  const score = vi.spyOn(bge, 'score').mockResolvedValue(new Map([['a', 1]]));
  const rag = new RagQueryService(
    { embedQuery: async () => [1] } as any,
    {
      searchKeywordChunks: async () => [
        {
          id: 'a',
          documentId: 'doc',
          version: 1,
          chunkIndex: 0,
          content: body,
          score: 1,
        },
      ],
      searchChunks: async () => [
        {
          id: 'a',
          documentId: 'doc',
          version: 1,
          chunkIndex: 0,
          content: body,
          score: 1,
        },
      ],
    } as any,
    {
      findVisiblePublishedIds: async () => ['doc'],
      findPublishedByIds: async () => [
        {
          id: 'doc',
          version: 1,
          title: '申请条件',
          category: null,
          team: null,
          tags: [],
        },
      ],
    } as any,
  );
  const retrieval = new AnswerRetrievalService(
    new HybridSearchService(
      rag,
      new HybridRerankService(new RerankService(), bge),
    ),
    {} as any,
    new GraphIntentService(),
  );
  const invoke = vi.fn().mockResolvedValue({
    content: answerOutput('需主管审批。', body),
    usage_metadata: { input_tokens: 12, output_tokens: 8, total_tokens: 20 },
  });
  const prompts = new AnswerPromptService();
  const answer = new AnswerService(
    retrieval,
    new AnswerContextService(prompts),
    new AnswerGenerationService(
      {
        modelName: 'test-model',
        generate: () => invokeAnswerModel(invoke, 'test-model'),
      },
      prompts,
    ),
    new AnswerCitationService(),
    service,
  );
  return { answer, service, logs, log, score, invoke };
}
const question = { question: '申请需要谁审批？', topK: 5 };
const user = { id: 'user', role: 'MEMBER' as const };

describe('full workflow observation isolation and correlation', () => {
  it.each([
    'disabled',
    'enabled',
    'sync-failure',
    'async-failure',
    'constructor-failure',
    'log-failure',
  ])(
    'preserves answer, evidence and call count when reporting is %s',
    async (mode) => {
      if (mode === 'constructor-failure')
        sdk.construct.mockImplementation(() => {
          throw new Error('private');
        });
      const f = fixture(mode !== 'disabled');
      if (mode === 'sync-failure') {
        for (const fn of [sdk.span, sdk.generation, sdk.event, sdk.updateTrace])
          fn.mockImplementation(() => {
            throw new Error('private-sdk-key');
          });
      }
      if (mode === 'async-failure') {
        sdk.flush.mockRejectedValue(new Error('private-sdk-key'));
        sdk.shutdown.mockRejectedValue(new Error('private-sdk-key'));
      }
      if (mode === 'log-failure')
        f.log.mockImplementation(() => {
          throw new Error('log failed');
        });
      expect(
        await f.answer.answer(question, user, 'request-test'),
      ).toMatchObject({
        status: 'answered',
        answer: '需主管审批。 [S1]',
        citations: [{ documentId: 'doc' }],
      });
      expect(f.invoke).toHaveBeenCalledTimes(1);
      expect(f.score).toHaveBeenCalledTimes(1);
      await f.service.onModuleDestroy();
      if (mode === 'log-failure') return;
      expect(new Set(f.logs.map((e) => e.requestId))).toEqual(
        new Set(['request-test']),
      );
      expect(f.logs.at(-1)).toMatchObject({
        event: 'rag.answer.completed',
        status: 'success',
        modelCalls: 1,
        reranks: [{ path: 'bge', reason: 'model_selected' }],
        usage: { reportedTotalTokens: 20, unknownCalls: 0 },
        stages: {
          'recall.keyword': { count: 1 },
          'recall.semantic.embedding': { count: 1 },
          'rerank.bge': { count: 1 },
          'context.build': { count: 1 },
          'citation.validate': { count: 1 },
          'citation.build': { count: 1 },
        },
      });
      expect(JSON.stringify(f.logs)).not.toMatch(
        /申请|主管|private|test-secret/,
      );
      if (mode === 'enabled') {
        expect(sdk.trace).toHaveBeenCalledWith(
          expect.objectContaining({ id: 'request-test' }),
        );
        expect(sdk.updateObservation).toHaveBeenCalledWith(
          expect.objectContaining({
            usageDetails: { input: 12, output: 8, total: 20 },
            endTime: expect.any(Date),
          }),
        );
      }
    },
  );

  it('relates rule fallback and generation failure to the same request without treating it as refusal', async () => {
    const f = fixture();
    f.score.mockRejectedValue(new BgeFailure('timeout'));
    f.invoke.mockRejectedValue({ status: 401, message: 'private-key' });
    await expect(f.answer.answer(question, user)).rejects.toMatchObject({
      code: 'MODEL_CONFIGURATION_ERROR',
    });
    expect(f.logs.at(-1)).toMatchObject({
      event: 'rag.answer.failed',
      status: 'error',
      stage: 'generation',
      errorCode: 'MODEL_CONFIGURATION_ERROR',
      reranks: [{ path: 'rule', reason: 'timeout' }],
      modelCalls: 1,
      usage: { unknownCalls: 1 },
    });
    expect(new Set(f.logs.map((e) => e.requestId)).size).toBe(1);
    expect(JSON.stringify(f.logs)).not.toContain('private');
  });

  it('isolates trace creation and individual observation completion failures too', async () => {
    const f = fixture(true);
    sdk.trace.mockImplementationOnce(() => {
      throw new Error('private-key');
    });
    await expect(f.answer.answer(question, user)).resolves.toHaveProperty(
      'status',
      'answered',
    );
    sdk.end.mockImplementation(() => {
      throw new Error('private-key');
    });
    sdk.updateObservation.mockImplementation(() => {
      throw new Error('private-key');
    });
    await expect(f.answer.answer(question, user)).resolves.toHaveProperty(
      'status',
      'answered',
    );
    expect(
      f.logs.filter((e) => e.event === 'rag.answer.completed'),
    ).toHaveLength(2);
  });

  it('records one timeout terminal and the aborted model call when the whole answer budget expires', async () => {
    vi.useFakeTimers();
    const f = fixture();
    // Retrieval spends 20 seconds; generation shares the remaining total budget.
    f.score.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20000));
      return new Map([['a', 1]]);
    });
    let release!: (value: { content: string }) => void;
    f.invoke.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const checked = expect(
      f.answer.answer(question, user),
    ).rejects.toMatchObject({ code: 'ANSWER_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(45000);
    await checked;
    const terminals = f.logs.filter((e) => e.event === 'rag.answer.failed');
    expect(terminals).toHaveLength(1);
    expect(terminals[0]).toMatchObject({
      errorCode: 'ANSWER_TIMEOUT',
      modelCalls: 1,
      usage: { unknownCalls: 1 },
      stages: { 'generation.total': { interrupted: 1 } },
    });
    expect(f.logs.find((e) => e.event === 'rag.answer.model')).toMatchObject({
      outcome: 'error',
      errorCode: 'ANSWER_TIMEOUT',
    });
    const count = f.logs.length;
    release({ content: 'late output' });
    await vi.advanceTimersByTimeAsync(1);
    expect(f.logs).toHaveLength(count);
    expect(vi.getTimerCount()).toBe(0);
  });
});
