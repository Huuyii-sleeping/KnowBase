import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AnswerTelemetry, safeErrorCode } from './answer-telemetry';
import { AnswerTrace, AnswerTraceExporter } from './answer-trace-exporter';

export interface AnswerTraceContext {
  readonly startedAt: number;
  readonly requestId: string;
  readonly telemetry?: AnswerTelemetry;
  readonly trace?: AnswerTrace;
}

@Injectable()
export class ObservabilityService implements OnModuleDestroy {
  private readonly logger = new Logger(ObservabilityService.name);
  private readonly exporter: AnswerTraceExporter;

  constructor(config: ConfigService) {
    this.exporter = new AnswerTraceExporter(config, this.logger);
  }

  startAnswerTrace(
    question: string,
    topK: number,
    requestId?: string,
  ): AnswerTraceContext {
    let trace: AnswerTrace | undefined;
    const telemetry = new AnswerTelemetry((event) => {
      try {
        const json = JSON.stringify(event);
        if (event.event === 'rag.answer.failed') this.logger.warn(json);
        else this.logger.log(json);
      } catch {
        /* Keep exporter delivery independent of a broken log sink. */
      }
      this.exporter.observe(trace, event);
    }, requestId);
    trace = this.exporter.start(telemetry.requestId, question, topK);
    return {
      startedAt: Date.now(),
      requestId: telemetry.requestId,
      telemetry,
      trace,
    };
  }

  recordRetrieval(
    context: AnswerTraceContext,
    input: { query: string; topK: number },
    output: { itemCount: number; items: unknown[]; graphUsed?: boolean },
    latencyMs: number,
  ): void {
    this.exporter.span(
      context.trace,
      'retrieval.hybrid-search',
      input,
      output,
      latencyMs,
    );
  }

  recordGrounding(
    context: AnswerTraceContext,
    input: { question: string; candidateCount: number },
    output: {
      selectedCount: number;
      selectedChunkIds: string[];
      promptBytes?: number;
      selectionPolicy?: string;
      omittedCount?: number;
    },
    latencyMs: number,
  ): void {
    this.exporter.span(
      context.trace,
      'retrieval.grounding',
      input,
      output,
      latencyMs,
    );
  }

  recordGeneration(
    context: AnswerTraceContext,
    input: { prompt: string; model: string },
    output: string,
    latencyMs: number,
  ): void {
    this.exporter.generation(context.trace, input, output, latencyMs);
  }

  completeAnswer(
    context: AnswerTraceContext,
    output: unknown,
    metadata: Record<string, unknown> = {},
  ): void {
    context.telemetry?.finish({
      status: metadata.status === 'refusal' ? 'refusal' : 'success',
      outcome:
        typeof metadata.outcome === 'string' ? metadata.outcome : undefined,
    });
    this.exporter.finish(context.trace, output, {
      ...metadata,
      requestId: context.requestId,
      latencyMs: Date.now() - context.startedAt,
    });
  }

  failAnswer(
    context: AnswerTraceContext,
    error: unknown,
    metadata: Record<string, unknown> = {},
  ): void {
    const errorCode = safeErrorCode(error);
    context.telemetry?.finish({
      status: 'error',
      errorCode,
      stage: typeof metadata.stage === 'string' ? metadata.stage : undefined,
    });
    this.exporter.finish(
      context.trace,
      { errorCode },
      {
        ...metadata,
        requestId: context.requestId,
        errorCode,
        status: 'error',
        latencyMs: Date.now() - context.startedAt,
      },
    );
  }

  onModuleDestroy(): Promise<void> {
    return this.exporter.shutdown();
  }
}
