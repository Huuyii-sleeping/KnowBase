import { TokenUsage } from './token-usage';

export type StageName =
  | 'retrieval.total'
  | 'recall.keyword'
  | 'recall.semantic'
  | 'recall.keyword.visibility'
  | 'recall.semantic.visibility'
  | 'recall.semantic.embedding'
  | 'recall.keyword.index'
  | 'recall.semantic.index'
  | 'recall.keyword.metadata'
  | 'recall.semantic.metadata'
  | 'recall.merge'
  | 'graph.retrieval'
  | 'rerank.total'
  | 'rerank.bge'
  | 'context.build'
  | 'generation.total'
  | 'citation.validate'
  | 'citation.build';

export type RerankReason =
  | 'model_selected'
  | 'configured_rule'
  | 'empty_pool'
  | 'api_busy'
  | 'cooldown'
  | 'unsupported_input'
  | 'runtime_busy'
  | 'timeout'
  | 'unavailable'
  | 'invalid_response'
  | 'request_too_large'
  | 'unknown_error';

export type TelemetryDetail =
  | { event: 'rag.answer.started' }
  | {
      event: 'rag.answer.stage';
      name: StageName;
      startedAt: string;
      latencyMs: number;
      outcome: 'completed' | 'error' | 'interrupted';
      errorCode?: string;
    }
  | {
      event: 'rag.answer.rerank';
      path: 'bge' | 'rule';
      reason: RerankReason;
      candidateCount: number;
    }
  | {
      event: 'rag.answer.model';
      model: string;
      purpose: 'initial' | 'citation_repair';
      latencyMs: number;
      outcome: 'completed' | 'error' | 'interrupted';
      errorCode?: string;
      startedAt: string;
      usage: TokenUsage;
      finishReason: string | null;
    }
  | { event: 'rag.answer.retry'; waitMs: number; errorCode: string }
  | { event: 'rag.answer.repair' };

export interface StageStats {
  count: number;
  latencyMs: number;
  failures: number;
  interrupted: number;
}

export interface AnswerTelemetrySummary {
  event: 'rag.answer.completed' | 'rag.answer.failed';
  status: 'success' | 'refusal' | 'error';
  errorCode?: string;
  stage?: string;
  outcome?: string;
  latencyMs: number;
  stages: Partial<Record<StageName, StageStats>>;
  reranks: Array<{ path: 'bge' | 'rule'; reason: RerankReason }>;
  modelCalls: number;
  transportRetries: number;
  citationRepairs: number;
  usage: {
    reportedInputTokens: number;
    reportedOutputTokens: number;
    reportedTotalTokens: number;
    completeCalls: number;
    unknownCalls: number;
  };
}

export type TelemetryEvent = (TelemetryDetail | AnswerTelemetrySummary) & {
  schemaVersion: 1;
  requestId: string;
};
