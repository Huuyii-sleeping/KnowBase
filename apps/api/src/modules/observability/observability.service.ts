import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Langfuse } from 'langfuse';

type LangfuseTrace = ReturnType<Langfuse['trace']>;
type LangfuseSpan = ReturnType<Langfuse['span']>;
type LangfuseGeneration = ReturnType<Langfuse['generation']>;

export interface AnswerTraceContext {
  readonly startedAt: number;
  readonly trace?: LangfuseTrace;
}

@Injectable()
export class ObservabilityService implements OnModuleDestroy {
  private readonly logger = new Logger(ObservabilityService.name);
  private readonly client: Langfuse | null;

  constructor(config: ConfigService) {
    const enabled = config.get<string>('LANGFUSE_ENABLED', 'false') === 'true';
    const publicKey = config.get<string>('LANGFUSE_PUBLIC_KEY');
    const secretKey = config.get<string>('LANGFUSE_SECRET_KEY');

    if (!enabled || !publicKey || !secretKey) {
      this.client = null;
      return;
    }

    this.client = new Langfuse({
      publicKey,
      secretKey,
      baseUrl: config.get<string>('LANGFUSE_BASE_URL', 'http://localhost:13000'),
      environment: config.get<string>('LANGFUSE_ENVIRONMENT', 'local'),
      release: config.get<string>('LANGFUSE_RELEASE', 'knowbase-local'),
      flushAt: 1,
      flushInterval: 1000,
      requestTimeout: 3000,
      enabled: true,
    });
    this.logger.log('Langfuse observability enabled');
  }

  startAnswerTrace(question: string, topK: number): AnswerTraceContext {
    if (!this.client) {
      return { startedAt: Date.now() };
    }

    try {
      const trace = this.client.trace({
        name: 'rag.answer',
        input: { question, topK },
        metadata: { component: 'answer' },
      });
      return { startedAt: Date.now(), trace };
    } catch (error) {
      this.logFailure('start answer trace', error);
      return { startedAt: Date.now() };
    }
  }

  recordRetrieval(
    context: AnswerTraceContext,
    input: { query: string; topK: number },
    output: { itemCount: number; items: unknown[] },
    latencyMs: number,
  ): void {
    this.endSpan(context.trace?.span({
      name: 'retrieval.hybrid-search',
      input,
    }), {
      output,
      metadata: { latencyMs },
    });
  }

  recordGrounding(
    context: AnswerTraceContext,
    input: { question: string; candidateCount: number },
    output: { selectedCount: number; selectedChunkIds: string[] },
    latencyMs: number,
  ): void {
    this.endSpan(context.trace?.span({
      name: 'retrieval.grounding',
      input,
    }), {
      output,
      metadata: { latencyMs },
    });
  }

  recordGeneration(
    context: AnswerTraceContext,
    input: { prompt: string; model: string },
    output: string,
    latencyMs: number,
  ): void {
    let generation: LangfuseGeneration | undefined;
    try {
      generation = context.trace?.generation({
        name: 'generation.ollama',
        model: input.model,
        input: input.prompt,
      });
      generation?.end({
        output,
        metadata: { latencyMs },
      });
    } catch (error) {
      this.logFailure('record generation', error);
    }
  }

  completeAnswer(
    context: AnswerTraceContext,
    output: unknown,
    metadata: Record<string, unknown> = {},
  ): void {
    try {
      context.trace?.update({
        output,
        metadata: {
          ...metadata,
          latencyMs: Date.now() - context.startedAt,
        },
      });
      void this.client?.flushAsync().catch((error: unknown) => {
        this.logFailure('flush trace', error);
      });
    } catch (error) {
      this.logFailure('complete answer trace', error);
    }
  }

  failAnswer(context: AnswerTraceContext, error: unknown): void {
    try {
      context.trace?.update({
        output: { error: this.errorMessage(error) },
        metadata: {
          status: 'error',
          latencyMs: Date.now() - context.startedAt,
        },
      });
      void this.client?.flushAsync().catch((flushError: unknown) => {
        this.logFailure('flush failed trace', flushError);
      });
    } catch (traceError) {
      this.logFailure('record answer failure', traceError);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.shutdownAsync();
  }

  private endSpan(
    span: LangfuseSpan | undefined,
    body: { output: unknown; metadata: Record<string, unknown> },
  ): void {
    try {
      span?.end(body);
    } catch (error) {
      this.logFailure('record span', error);
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private logFailure(operation: string, error: unknown): void {
    this.logger.warn(`Langfuse failed to ${operation}: ${this.errorMessage(error)}`);
  }
}
