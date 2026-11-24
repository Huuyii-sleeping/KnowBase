import { Injectable, Logger } from '@nestjs/common';
import { BgeHttpService } from './bge-http.service';
import { selectBge } from './bge-selection';
import { RerankService, RerankedCandidate } from './rerank.service';
import { RerankableCandidate, RerankOptions } from './rerank.types';
import { BgeFailure } from './bge-failure';
import {
  emitAnswerTelemetry,
  observeAsyncStage,
} from '../../observability/answer-telemetry';
import { RerankReason } from '../../observability/answer-telemetry.types';

@Injectable()
export class HybridRerankService {
  private readonly logger = new Logger(HybridRerankService.name);
  private inFlight = false;
  private retryAt = 0;

  constructor(
    private readonly rule: RerankService,
    private readonly model: BgeHttpService,
  ) {}

  async rerank<T extends RerankableCandidate>(
    query: string,
    candidates: T[],
    options: RerankOptions,
  ): Promise<RerankedCandidate<T>[]> {
    const baseline = this.rule.rerank(query, candidates, options);
    const fallback = (reason: RerankReason) => {
      emitAnswerTelemetry({
        event: 'rag.answer.rerank',
        path: 'rule',
        reason,
        candidateCount: candidates.length,
      });
      return baseline;
    };
    if (this.model.settings.mode === 'rule') return fallback('configured_rule');
    if (!candidates.length) return fallback('empty_pool');
    // Never queue unbounded GPU work in an API process. Failures open a short cooldown.
    if (this.inFlight) return fallback('api_busy');
    if (Date.now() < this.retryAt) return fallback('cooldown');
    const ids = candidates.map((item) => item.chunkId);
    if (
      !query.trim() ||
      query.length > 2048 ||
      candidates.length > 120 ||
      ids.some((id) => !id) ||
      new Set(ids).size !== ids.length
    )
      return fallback('unsupported_input');
    this.inFlight = true;
    try {
      const scores = await observeAsyncStage('rerank.bge', () =>
        this.model.score(query, candidates),
      );
      if (
        scores.size !== candidates.length ||
        ids.some((id) => !Number.isFinite(scores.get(id!)))
      ) {
        throw new BgeFailure('invalid_response');
      }
      const result = selectBge(candidates, baseline, scores, options);
      emitAnswerTelemetry({
        event: 'rag.answer.rerank',
        path: 'bge',
        reason: 'model_selected',
        candidateCount: candidates.length,
      });
      return result;
    } catch (error) {
      this.retryAt = Date.now() + this.model.settings.cooldownMs;
      this.logger.warn(
        'BGE rerank failed; using complete rule result during cooldown',
      );
      return fallback(
        error instanceof BgeFailure ? error.reason : 'unknown_error',
      );
    } finally {
      this.inFlight = false;
    }
  }
}
