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
      throw new Error('BGE request too large');
    const response = await fetch(`${this.settings.endpoint}/rerank`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      signal: AbortSignal.timeout(this.settings.timeoutMs),
      redirect: 'error',
    });
    if (!response.ok) throw new Error('BGE endpoint unavailable');
    const bytes: Uint8Array[] = [];
    let length = 0;
    if (!response.body) throw new Error('Empty BGE response');
    // Bound the response as well as the request; the same deadline covers body reads.
    for await (const part of response.body) {
      length += part.length;
      if (length > 65536) {
        throw new Error('BGE response too large');
      }
      bytes.push(part);
    }
    const result = JSON.parse(Buffer.concat(bytes).toString('utf8'));
    if (
      result.requestId !== requestId ||
      result.model !== BGE_MODEL ||
      !Array.isArray(result.scores) ||
      result.scores.length !== candidates.length
    ) {
      throw new Error('Invalid BGE response identity');
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
        throw new Error('Invalid BGE candidate score');
      }
      scores.set(item.id, item.score);
    }
    return scores;
  }
}
