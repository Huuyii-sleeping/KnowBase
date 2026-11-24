import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { AnswerFailure } from '../answer/answer-failure';
import {
  AnswerTelemetrySummary,
  StageName,
  TelemetryDetail,
  TelemetryEvent,
} from './answer-telemetry.types';

const storage = new AsyncLocalStorage<AnswerTelemetry>();
export const safeErrorCode = (error: unknown): string =>
  error instanceof AnswerFailure ? error.code : 'INTERNAL_ERROR';

export class AnswerTelemetry {
  private readonly started = performance.now();
  private closed = false;
  private readonly finalizers = new Set<(code?: string) => void>();
  private readonly pending = new Set<
    (outcome: 'completed' | 'error' | 'interrupted', error?: unknown) => void
  >();
  private readonly summary: Omit<
    AnswerTelemetrySummary,
    'event' | 'status' | 'latencyMs'
  > = {
    stages: {},
    reranks: [],
    modelCalls: 0,
    transportRetries: 0,
    citationRepairs: 0,
    usage: {
      reportedInputTokens: 0,
      reportedOutputTokens: 0,
      reportedTotalTokens: 0,
      completeCalls: 0,
      unknownCalls: 0,
    },
  };

  constructor(
    private readonly sink: (event: TelemetryEvent) => void,
    readonly requestId: string = randomUUID(),
  ) {
    this.send({ event: 'rag.answer.started' });
  }

  onFinish(callback: (code?: string) => void): () => void {
    if (!this.closed) this.finalizers.add(callback);
    return () => {
      this.finalizers.delete(callback);
    };
  }

  emit(detail: TelemetryDetail): void {
    if (this.closed) return;
    if (detail.event === 'rag.answer.stage') {
      const stats = (this.summary.stages[detail.name] ??= {
        count: 0,
        latencyMs: 0,
        failures: 0,
        interrupted: 0,
      });
      stats.count++;
      stats.latencyMs += detail.latencyMs;
      if (detail.outcome === 'error') stats.failures++;
      if (detail.outcome === 'interrupted') stats.interrupted++;
    } else if (detail.event === 'rag.answer.rerank') {
      this.summary.reranks.push({ path: detail.path, reason: detail.reason });
    } else if (detail.event === 'rag.answer.model') {
      this.summary.modelCalls++;
      const usage = detail.usage;
      this.summary.usage.reportedInputTokens += usage.inputTokens ?? 0;
      this.summary.usage.reportedOutputTokens += usage.outputTokens ?? 0;
      this.summary.usage.reportedTotalTokens += usage.totalTokens ?? 0;
      if (Object.values(usage).every((v) => v !== null))
        this.summary.usage.completeCalls++;
      else this.summary.usage.unknownCalls++;
    } else if (detail.event === 'rag.answer.retry')
      this.summary.transportRetries++;
    else if (detail.event === 'rag.answer.repair')
      this.summary.citationRepairs++;
    this.send(detail);
  }

  beginStage(name: StageName) {
    const started = performance.now();
    const startedAt = new Date().toISOString();
    let finished = false;
    const end = (
      outcome: 'completed' | 'error' | 'interrupted',
      error?: unknown,
    ) => {
      if (finished) return;
      finished = true;
      this.pending.delete(end);
      this.emit({
        event: 'rag.answer.stage',
        name,
        startedAt,
        latencyMs: performance.now() - started,
        outcome,
        ...(error ? { errorCode: safeErrorCode(error) } : {}),
      });
    };
    if (!this.closed) this.pending.add(end);
    return end;
  }

  finish(
    result: Pick<
      AnswerTelemetrySummary,
      'status' | 'errorCode' | 'stage' | 'outcome'
    >,
  ): void {
    if (this.closed) return;
    for (const finalize of this.finalizers) finalize(result.errorCode);
    this.finalizers.clear();
    for (const end of this.pending) end('interrupted');
    this.closed = true;
    this.send({
      ...this.summary,
      ...result,
      event:
        result.status === 'error'
          ? 'rag.answer.failed'
          : 'rag.answer.completed',
      latencyMs: performance.now() - this.started,
    });
    this.pending.clear();
  }

  private send(detail: TelemetryDetail | AnswerTelemetrySummary): void {
    try {
      this.sink({ ...detail, schemaVersion: 1, requestId: this.requestId });
    } catch {
      /* An observation failure never changes the business result. */
    }
  }
}

export function withAnswerTelemetry<T>(
  session: AnswerTelemetry | undefined,
  work: () => T,
): T {
  return session ? storage.run(session, work) : work();
}

export function emitAnswerTelemetry(detail: TelemetryDetail): void {
  storage.getStore()?.emit(detail);
}

export function onAnswerFinished(
  callback: (code?: string) => void,
): () => void {
  const session = storage.getStore();
  return (
    session?.onFinish((code) => storage.run(session, () => callback(code))) ??
    (() => {})
  );
}

export async function observeAsyncStage<T>(
  name: StageName,
  work: () => Promise<T>,
): Promise<T> {
  const end = storage.getStore()?.beginStage(name);
  try {
    const result = await work();
    end?.('completed');
    return result;
  } catch (error) {
    end?.('error', error);
    throw error;
  }
}

export function observeSyncStage<T>(name: StageName, work: () => T): T {
  const end = storage.getStore()?.beginStage(name);
  try {
    const result = work();
    end?.('completed');
    return result;
  } catch (error) {
    end?.('error', error);
    throw error;
  }
}
