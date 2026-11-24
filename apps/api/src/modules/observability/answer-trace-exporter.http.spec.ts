import { afterEach, describe, expect, it } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { AnswerTraceExporter } from './answer-trace-exporter';

let server: Server | undefined;
afterEach(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  }
});

describe('actual Langfuse SDK export contract', () => {
  it('delivers correlated observations, original timestamps and known/unknown usage to local ingestion', async () => {
    const batches: any[] = [];
    server = createServer(async (req, res) => {
      let text = '';
      for await (const chunk of req) text += chunk;
      const batch = JSON.parse(text).batch;
      batches.push(...batch);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          successes: batch.map((event: any) => ({ id: event.id, status: 201 })),
          errors: [],
        }),
      );
    });
    await new Promise<void>((resolve) =>
      server!.listen(0, '127.0.0.1', resolve),
    );
    const exporter = new AnswerTraceExporter(
      new ConfigService({
        LANGFUSE_ENABLED: 'true',
        LANGFUSE_PUBLIC_KEY: 'test-public',
        LANGFUSE_SECRET_KEY: 'test-secret',
        LANGFUSE_BASE_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      }),
      new Logger('ExporterContract'),
    );
    const id = randomUUID();
    const trace = exporter.start(id, 'fixture', 5);
    const startedAt = '2026-11-24T00:00:00.000Z';
    try {
      exporter.observe(trace, {
        schemaVersion: 1,
        requestId: id,
        event: 'rag.answer.stage',
        name: 'context.build',
        outcome: 'completed',
        latencyMs: 12,
        startedAt,
      });
      for (const inputTokens of [12, null])
        exporter.observe(trace, {
          schemaVersion: 1,
          requestId: id,
          event: 'rag.answer.model',
          model: 'test-model',
          purpose: 'initial',
          startedAt,
          latencyMs: 20,
          outcome: 'completed',
          finishReason: 'stop',
          usage: {
            inputTokens,
            outputTokens: inputTokens === null ? null : 8,
            totalTokens: inputTokens === null ? null : 20,
          },
        });
      exporter.finish(trace, { status: 'answered' }, { requestId: id });
    } finally {
      await exporter.shutdown();
    }
    expect(
      batches.some((e) => e.type === 'trace-create' && e.body.id === id),
    ).toBe(true);
    const stageUpdate = batches.find((e) => e.type === 'span-update');
    expect(stageUpdate.body.endTime).toBe('2026-11-24T00:00:00.012Z');
    const generations = batches.filter((e) => e.type === 'generation-update');
    expect(generations).toHaveLength(2);
    expect(generations[0].body).toMatchObject({
      usageDetails: { input: 12, output: 8, total: 20 },
    });
    expect(generations[1].body).toMatchObject({
      usageDetails: {},
      metadata: { usage: { inputTokens: null, totalTokens: null } },
    });
    expect(
      batches.filter((e) => e.body.traceId).every((e) => e.body.traceId === id),
    ).toBe(true);
  });
});
