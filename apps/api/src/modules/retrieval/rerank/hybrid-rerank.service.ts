import { Injectable, Logger } from '@nestjs/common';
import { BgeHttpService } from './bge-http.service';
import { selectBge } from './bge-selection';
import { RerankService, RerankedCandidate } from './rerank.service';
import { RerankableCandidate, RerankOptions } from './rerank.types';

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
    if (this.model.settings.mode === 'rule' || !candidates.length)
      return baseline;
    // Never queue unbounded GPU work in an API process. Failures open a short cooldown.
    if (this.inFlight || Date.now() < this.retryAt) return baseline;
    const ids = candidates.map((item) => item.chunkId);
    if (
      !query.trim() ||
      query.length > 2048 ||
      candidates.length > 120 ||
      ids.some((id) => !id) ||
      new Set(ids).size !== ids.length
    )
      return baseline;
    this.inFlight = true;
    try {
      const scores = await this.model.score(query, candidates);
      if (
        scores.size !== candidates.length ||
        ids.some((id) => !Number.isFinite(scores.get(id!)))
      ) {
        throw new Error('Incomplete BGE scores');
      }
      return selectBge(candidates, baseline, scores, options);
    } catch {
      this.retryAt = Date.now() + this.model.settings.cooldownMs;
      this.logger.warn(
        'BGE rerank failed; using complete rule result during cooldown',
      );
      return baseline;
    } finally {
      this.inFlight = false;
    }
  }
}
