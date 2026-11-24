import { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer, Server } from 'node:http';
import { BGE_MODEL, BgeHttpService } from './bge-http.service';
import { bgeConfig } from './bge-config';
import { candidate } from './bge.fixture';

describe('BGE HTTP adapter', () => {
  let server: Server | undefined;
  afterEach(async () => {
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = undefined;
    }
  });

  async function endpoint(
    reply: (body: any, response: import('node:http').ServerResponse) => void,
    timeoutMs = 1000,
  ) {
    server = createServer(async (request, response) => {
      let bytes = '';
      for await (const part of request) bytes += part;
      expect(request.url).toBe('/rerank');
      expect(request.headers['content-type']).toBe('application/json');
      reply(JSON.parse(bytes), response);
    });
    await new Promise<void>((resolve) =>
      server!.listen(0, '127.0.0.1', resolve),
    );
    const { port } = server.address() as import('node:net').AddressInfo;
    return new BgeHttpService(
      new ConfigService({
        RAG_RERANKER: 'bge',
        BGE_RERANK_URL: `http://127.0.0.1:${port}`,
        BGE_RERANK_TIMEOUT_MS: timeoutMs,
      }),
    );
  }

  it('serializes only query and exact candidate identity/title/body, accepts reordered negative scores', async () => {
    const model = await endpoint((body, response) => {
      expect(body.query).toBe('权限条件？');
      expect(body.candidates).toEqual([
        { id: 'a', title: '证据', content: '正文证据' },
        { id: 'b', title: '证据', content: '正文证据' },
      ]);
      response.end(
        JSON.stringify({
          requestId: body.requestId,
          model: BGE_MODEL,
          scores: [
            { id: 'b', score: -2 },
            { id: 'a', score: -3 },
          ],
        }),
      );
    });
    expect(
      await model.score('权限条件？', [candidate('a'), candidate('b')]),
    ).toEqual(
      new Map([
        ['b', -2],
        ['a', -3],
      ]),
    );
  });

  it.each([
    'request',
    'model',
    'missing',
    'duplicate',
    'foreign',
    'string',
    'null',
    'huge',
    'http',
    'json',
  ])('rejects %s responses as a whole', async (failure) => {
    const model = await endpoint((body, response) => {
      const result = {
        requestId: body.requestId,
        model: BGE_MODEL,
        scores: [
          { id: 'a', score: 1 },
          { id: 'b', score: 2 },
        ],
      };
      if (failure === 'request') result.requestId = 'wrong';
      if (failure === 'model') result.model = 'different';
      if (failure === 'missing') result.scores.pop();
      if (failure === 'duplicate') result.scores[1].id = 'a';
      if (failure === 'foreign') result.scores[1].id = 'outside';
      if (failure === 'string') (result.scores[0] as any).score = '1';
      if (failure === 'null') (result.scores[0] as any).score = null;
      if (failure === 'huge') {
        response.end(' '.repeat(65537));
        return;
      }
      if (failure === 'http') response.statusCode = 503;
      response.end(failure === 'json' ? '{invalid' : JSON.stringify(result));
    });
    await expect(
      model.score('证据', [candidate('a'), candidate('b')]),
    ).rejects.toThrow();
  });

  it('enforces the same deadline after response headers while reading a stalled body', async () => {
    const model = await endpoint((_, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.flushHeaders();
      response.write('{');
    }, 40);
    const started = performance.now();
    await expect(model.score('证据', [candidate('a')])).rejects.toMatchObject({
      reason: 'timeout',
    });
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it.each([
    [503, 'model busy', 'runtime_busy'],
    [503, 'model failed', 'unavailable'],
    [502, 'private upstream body', 'unavailable'],
  ])(
    'classifies HTTP %s / %s without exposing provider text',
    async (status, error, reason) => {
      const model = await endpoint((_, response) => {
        response.statusCode = status;
        response.end(JSON.stringify({ error }));
      });
      await expect(model.score('证据', [candidate('a')])).rejects.toMatchObject(
        { reason },
      );
    },
  );

  it('classifies malformed success and oversized requests before inference', async () => {
    const model = await endpoint((_, response) => response.end('null'));
    await expect(model.score('证据', [candidate('a')])).rejects.toMatchObject({
      reason: 'invalid_response',
    });
    await expect(
      model.score('证据', [
        { ...candidate('a'), content: 'a'.repeat(2 * 1024 * 1024) },
      ]),
    ).rejects.toMatchObject({ reason: 'request_too_large' });
  });

  it('validates config before startup rather than silently using a different mode', () => {
    expect(bgeConfig(new ConfigService()).mode).toBe('bge');
    expect(bgeConfig(new ConfigService({ RAG_RERANKER: 'rule' })).mode).toBe(
      'rule',
    );
    for (const values of [
      { RAG_RERANKER: 'typo' },
      { BGE_RERANK_TIMEOUT_MS: 0 },
      { BGE_RERANK_COOLDOWN_MS: 'bad' },
      { BGE_RERANK_URL: 'file:///tmp/x' },
      { BGE_RERANK_URL: 'http://user:secret@localhost' },
      { BGE_RERANK_URL: 'http://localhost/path' },
    ])
      expect(() => bgeConfig(new ConfigService(values))).toThrow();
  });
});
