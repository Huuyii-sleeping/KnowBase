import { BgeFailure } from './bge-failure';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { bgeConfig } from './bge-config';
import { RerankableCandidate } from './rerank.types';

export const BGE_MODEL = 'BAAI/bge-reranker-v2-m3';

@Injectable()
export class BgeHttpService {
  readonly settings: ReturnType<typeof bgeConfig>;

  constructor(config: ConfigService) {
    this.settings = bgeConfig(config);
  }

  async score(
    query: string,
    candidates: RerankableCandidate[],
  ): Promise<Map<string, number>> {
    try {
      return await this.requestScores(query, candidates);
    } catch (error) {
      if (error instanceof BgeFailure) throw error;
      const name = error instanceof Error ? error.name : '';
      throw new BgeFailure(
        ['TimeoutError', 'AbortError'].includes(name)
          ? 'timeout'
          : 'unavailable',
      );
    }
  }

  private async requestScores(
    query: string,
    candidates: RerankableCandidate[],
  ): Promise<Map<string, number>> {
    const requestId = randomUUID();
    const body = JSON.stringify({
      requestId,
      query,
      candidates: candidates.map((item) => ({
        id: item.chunkId,
        title: item.title,
        content: item.content ?? '',
      })),
    });
    if (Buffer.byteLength(body) > 2 * 1024 * 1024)
      throw new BgeFailure('request_too_large');
    const response = await fetch(`${this.settings.endpoint}/rerank`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      signal: AbortSignal.timeout(this.settings.timeoutMs),
      redirect: 'error',
    });
    const bytes: Uint8Array[] = [];
    let length = 0;
    if (!response.body) throw new BgeFailure('invalid_response');
    // Bound the response as well as the request; the same deadline covers body reads.
    for await (const part of response.body) {
      length += part.length;
      if (length > 65536) {
        throw new BgeFailure('invalid_response');
      }
      bytes.push(part);
    }
    let result: any;
    try {
      result = JSON.parse(Buffer.concat(bytes).toString('utf8'));
    } catch {
      throw new BgeFailure(response.ok ? 'invalid_response' : 'unavailable');
    }
    // This runtime uses 503 for both busy and failed inference. Status alone
    // cannot distinguish them; recognize only its fixed busy code.
    if (!response.ok)
      throw new BgeFailure(
        response.status === 503 && result?.error === 'model busy'
          ? 'runtime_busy'
          : 'unavailable',
      );
    if (
      !result ||
      result.requestId !== requestId ||
      result.model !== BGE_MODEL ||
      !Array.isArray(result.scores) ||
      result.scores.length !== candidates.length
    ) {
      throw new BgeFailure('invalid_response');
    }
    const expected = new Set(candidates.map((item) => item.chunkId));
    const scores = new Map<string, number>();
    for (const item of result.scores) {
      if (
        !item ||
        !expected.has(item.id) ||
        scores.has(item.id) ||
        typeof item.score !== 'number' ||
        !Number.isFinite(item.score)
      ) {
        throw new BgeFailure('invalid_response');
      }
      scores.set(item.id, item.score);
    }
    return scores;
  }
}
