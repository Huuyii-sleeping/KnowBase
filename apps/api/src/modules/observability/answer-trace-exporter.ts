import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Langfuse } from 'langfuse';
import { TelemetryEvent } from './answer-telemetry.types';

export type AnswerTrace = ReturnType<Langfuse['trace']>;

// Isolate SDK creation, synchronous calls and asynchronous delivery failures.
export class AnswerTraceExporter {
  private readonly client: Langfuse | null;

  constructor(
    config: ConfigService,
    private readonly logger: Logger,
  ) {
    this.client = this.createClient(config);
  }

  start(id: string, question: string, topK: number): AnswerTrace | undefined {
    return this.safe(() =>
      this.client?.trace({
        id,
        name: 'rag.answer',
        input: { question, topK },
        metadata: { requestId: id, component: 'answer' },
      }),
    );
  }

  span(
    trace: AnswerTrace | undefined,
    name: string,
    input: unknown,
    output: unknown,
    latencyMs: number,
  ): void {
    this.safe(() =>
      trace?.span({ name, input })?.end({ output, metadata: { latencyMs } }),
    );
  }

  generation(
    trace: AnswerTrace | undefined,
    input: { prompt: string; model: string },
    output: string,
    latencyMs: number,
  ): void {
    this.safe(() =>
      trace
        ?.generation({
          name: 'generation.answer',
          model: input.model,
          input: input.prompt,
        })
        ?.end({ output, metadata: { latencyMs } }),
    );
  }

  observe(trace: AnswerTrace | undefined, event: TelemetryEvent): void {
    this.safe(() => {
      if (event.event === 'rag.answer.stage') {
        trace
          ?.span({ name: event.name, startTime: new Date(event.startedAt) })
          ?.update({
            endTime: new Date(Date.parse(event.startedAt) + event.latencyMs),
            metadata: event,
          });
      } else if (event.event === 'rag.answer.model') {
        const usageDetails: Record<string, number> = {};
        if (event.usage.inputTokens !== null)
          usageDetails.input = event.usage.inputTokens;
        if (event.usage.outputTokens !== null)
          usageDetails.output = event.usage.outputTokens;
        if (event.usage.totalTokens !== null)
          usageDetails.total = event.usage.totalTokens;
        trace
          ?.generation({
            name: 'model.call',
            model: event.model,
            startTime: new Date(event.startedAt),
          })
          ?.update({
            endTime: new Date(Date.parse(event.startedAt) + event.latencyMs),
            usageDetails,
            metadata: event,
          });
      } else trace?.event({ name: event.event, metadata: event });
    });
  }

  finish(
    trace: AnswerTrace | undefined,
    output: unknown,
    metadata: Record<string, unknown>,
  ): void {
    this.safe(() => {
      trace?.update({ output, metadata });
      void this.client?.flushAsync().catch(() => this.warn());
    });
  }

  async shutdown(): Promise<void> {
    try {
      await this.client?.shutdownAsync();
    } catch {
      this.warn();
    }
  }

  private createClient(config: ConfigService): Langfuse | null {
    if (config.get<string>('LANGFUSE_ENABLED', 'false') !== 'true') return null;
    const publicKey = config.get<string>('LANGFUSE_PUBLIC_KEY');
    const secretKey = config.get<string>('LANGFUSE_SECRET_KEY');
    if (!publicKey || !secretKey) return null;
    return (
      this.safe(
        () =>
          new Langfuse({
            publicKey,
            secretKey,
            baseUrl: config.get<string>(
              'LANGFUSE_BASE_URL',
              'http://localhost:13000',
            ),
            environment: config.get<string>('LANGFUSE_ENVIRONMENT', 'local'),
            release: config.get<string>('LANGFUSE_RELEASE', 'knowbase-local'),
            flushAt: 1,
            flushInterval: 1000,
            requestTimeout: 3000,
            enabled: true,
          }),
      ) ?? null
    );
  }

  private safe<T>(work: () => T): T | undefined {
    try {
      return work();
    } catch {
      this.warn();
      return undefined;
    }
  }

  private warn(): void {
    try {
      this.logger.warn('Langfuse observation delivery failed');
    } catch {
      /* Logging is best effort too. */
    }
  }
}
