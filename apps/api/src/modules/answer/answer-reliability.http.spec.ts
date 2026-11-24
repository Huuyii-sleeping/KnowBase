import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { AnswerController } from './answer.controller';
import { AnswerService } from './answer.service';
import { AnswerGenerationService } from './answer-generation.service';
import { AnswerPromptService } from './answer-prompt.service';
import { AnswerContextService } from './answer-context.service';
import { AnswerCitationService } from './answer-citation.service';
import { ChatModelService } from './chat-model.service';
import { answerOutput, source, refusalOutput } from './answer.fixture';

const apps: INestApplication[] = [];
const servers: Server[] = [];
const facts = [source('a', '申请需要主管审批。')];
const completion = (content: string, reason = 'stop') => ({
  id: 'test-completion',
  object: 'chat.completion',
  created: 1,
  model: 'test-model',
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content },
      finish_reason: reason,
    },
  ],
});
type Reply = {
  disconnect?: boolean;
  status?: number;
  content?: string;
  finish?: string;
  headers?: Record<string, string>;
};

async function fixture(replies: Reply[]) {
  let calls = 0;
  const upstream = createServer(async (req, res) => {
    for await (const _ of req) {
      /* consume real SDK request */
    }
    calls++;
    const reply = replies.shift() ?? { status: 500 };
    if (reply.disconnect) {
      res.destroy();
      return;
    }
    res.writeHead(reply.status ?? 200, {
      'content-type': 'application/json',
      ...reply.headers,
    });
    res.end(
      JSON.stringify(
        reply.status && reply.status !== 200
          ? {
              error: {
                message: 'secret-test-key private-url sensitive-document',
                type: 'api_error',
              },
            }
          : completion(reply.content ?? '', reply.finish),
      ),
    );
  });
  servers.push(upstream);
  await new Promise<void>((resolve) =>
    upstream.listen(0, '127.0.0.1', resolve),
  );
  const model = new ChatModelService(
    new ConfigService({
      DEEPSEEK_API_KEY: 'secret-test-key',
      DEEPSEEK_BASE_URL: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/v1`,
    }),
  );
  const prompts = new AnswerPromptService();
  const events: Array<{ type: string; metadata?: unknown }> = [];
  const observability = {
    startAnswerTrace: () => ({ startedAt: Date.now() }),
    recordRetrieval: () => {},
    recordGrounding: () => {},
    recordGeneration: () => {},
    completeAnswer: (_trace: unknown, _output: unknown, metadata: unknown) =>
      events.push({ type: 'complete', metadata }),
    failAnswer: (_trace: unknown, _error: unknown, metadata: unknown) =>
      events.push({ type: 'failure', metadata }),
  };
  const service = new AnswerService(
    { retrieve: async () => ({ items: facts, graphUsed: false }) } as any,
    new AnswerContextService(prompts),
    new AnswerGenerationService(model, prompts),
    new AnswerCitationService(),
    observability as any,
  );
  // Vitest's TS transform omits decorator type metadata; Nest build emits it.
  Reflect.defineMetadata(
    'design:paramtypes',
    [AnswerService],
    AnswerController,
  );
  const module = await Test.createTestingModule({
    controllers: [AnswerController],
    providers: [{ provide: AnswerService, useValue: service }],
  }).compile();
  const app = module.createNestApplication({ logger: false });
  apps.push(app);
  await app.listen(0, '127.0.0.1');
  return {
    calls: () => calls,
    events,
    url: await app.getUrl(),
  };
}
async function ask(f: Awaited<ReturnType<typeof fixture>>) {
  const response = await fetch(f.url + '/rag/answer', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question: '申请需要谁审批？', topK: 5 }),
  });
  return {
    status: response.status,
    body: await response.json(),
    retryAfter: response.headers.get('retry-after'),
    requestId: response.headers.get('x-request-id'),
  };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
          server.closeAllConnections();
        }),
    ),
  );
});

describe('answer fault injection over actual Nest HTTP and model SDK', () => {
  it('recovers a 503 and returns the same validated evidence rather than a refusal', async () => {
    const f = await fixture([
      { status: 503 },
      { content: answerOutput('需主管审批。', '申请需要主管审批。') },
    ]);
    const result = await ask(f);
    expect(result.status).toBe(201);
    expect(result.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.body).toMatchObject({
      status: 'answered',
      answer: '需主管审批。 [S1]',
    });
    expect(result.body.citations).toHaveLength(1);
    expect(f.calls()).toBe(2);
    expect(f.events).toEqual([
      {
        type: 'complete',
        metadata: expect.objectContaining({
          modelCalls: 2,
          transportRetries: 1,
        }),
      },
    ]);
  });

  it.each([
    [401, 503, 'MODEL_CONFIGURATION_ERROR', false, 1],
    [429, 503, 'MODEL_RATE_LIMITED', true, 2],
    [500, 503, 'MODEL_UNAVAILABLE', true, 1],
    [503, 503, 'MODEL_UNAVAILABLE', true, 2],
    [504, 504, 'MODEL_TIMEOUT', true, 1],
  ])(
    'serializes upstream %s as a safe explicit failure',
    async (upstream, status, code, retryable, calls) => {
      const f = await fixture([{ status: upstream }, { status: upstream }]);
      const result = await ask(f);
      expect(result.status).toBe(status);
      expect(result.requestId).toMatch(/^[0-9a-f-]{36}$/);
      expect(result.body).toMatchObject({
        statusCode: status,
        code,
        retryable,
        message: expect.any(String),
      });
      expect(result.body).not.toHaveProperty('answer');
      expect(result.body).not.toHaveProperty('status', 'insufficient');
      expect(JSON.stringify(result)).not.toMatch(
        /secret-test-key|private-url|sensitive-document/,
      );
      expect(f.calls()).toBe(calls);
      expect(f.events).toHaveLength(1);
      expect(f.events[0].type).toBe('failure');
    },
  );

  it('recovers a reset connection through the actual SDK cause chain', async () => {
    const f = await fixture([
      { disconnect: true },
      { content: answerOutput('需主管审批。', '申请需要主管审批。') },
    ]);
    expect(await ask(f)).toMatchObject({
      status: 201,
      body: { status: 'answered' },
    });
    expect(f.calls()).toBe(2);
  });

  it('respects a service-unavailable Retry-After rather than retrying too early', async () => {
    const f = await fixture([
      { status: 503, headers: { 'retry-after': '60' } },
    ]);
    expect(await ask(f)).toMatchObject({
      status: 503,
      retryAfter: '60',
      body: { code: 'MODEL_UNAVAILABLE' },
    });
    expect(f.calls()).toBe(1);
  });

  it('passes a long Retry-After to the caller without automatic retries', async () => {
    const f = await fixture([
      { status: 429, headers: { 'retry-after': '60' } },
    ]);
    expect(await ask(f)).toMatchObject({
      status: 503,
      retryAfter: '60',
      body: { code: 'MODEL_RATE_LIMITED' },
    });
    expect(f.calls()).toBe(1);
  });

  it('recovers short rate limiting through the real SDK', async () => {
    const f = await fixture([
      { status: 429, headers: { 'retry-after': '0.05' } },
      { content: answerOutput('需主管审批。', '申请需要主管审批。') },
    ]);
    expect(await ask(f)).toMatchObject({
      status: 201,
      body: { status: 'answered' },
    });
    expect(f.calls()).toBe(2);
  });

  it.each([
    [{ content: '', finish: 'stop' }, 'MODEL_INVALID_RESPONSE'],
    [{ content: 'partial answer', finish: 'length' }, 'MODEL_OUTPUT_LIMIT'],
  ])(
    'returns invalid model content as a service failure without transport recovery',
    async (reply, code) => {
      const f = await fixture([reply]);
      expect(await ask(f)).toMatchObject({ status: 502, body: { code } });
      expect(f.calls()).toBe(1);
    },
  );

  it('keeps a genuine model refusal as a normal answer response', async () => {
    const f = await fixture([{ content: refusalOutput() }]);
    expect(await ask(f)).toMatchObject({
      status: 201,
      body: { status: 'insufficient', citations: [], contexts: [] },
    });
    expect(f.calls()).toBe(1);
  });
});
