import { Injectable } from '@nestjs/common';
import { RerankableCandidate, RerankOptions } from './rerank.types';

export type RerankedCandidate<T extends RerankableCandidate> = T & {
  rerankScore: number;
};

@Injectable()
export class RerankService {
  rerank<T extends RerankableCandidate>(
    query: string,
    candidates: T[],
    options: RerankOptions,
  ): RerankedCandidate<T>[] {
    const maxKeywordScore = this.maxScore(candidates.map((candidate) => candidate.keywordScore ?? 0));
    const maxSemanticScore = this.maxScore(candidates.map((candidate) => candidate.semanticScore ?? 0));
    const ranked = candidates
      .map((candidate) => ({
        candidate,
        rerankScore: this.score(
          query,
          candidate,
          maxKeywordScore,
          maxSemanticScore,
        ),
      }))
      .sort((left, right) => right.rerankScore - left.rerankScore);
    const maxChunksPerDocument = options.maxChunksPerDocument ?? 2;
    const maxContextCharacters = options.maxContextCharacters ?? 6000;
    const documentCounts = new Map<string, number>();
    const selected: RerankedCandidate<T>[] = [];
    let contextCharacters = 0;

    for (const item of ranked) {
      if (selected.length >= options.topK) {
        break;
      }
      const documentCount = documentCounts.get(item.candidate.documentId) ?? 0;
      if (documentCount >= maxChunksPerDocument) {
        continue;
      }
      const contentCharacters = item.candidate.content?.length ?? 0;
      if (
        contentCharacters > 0
        && contextCharacters + contentCharacters > maxContextCharacters
        && selected.length > 0
      ) {
        continue;
      }

      selected.push({ ...item.candidate, rerankScore: item.rerankScore });
      documentCounts.set(item.candidate.documentId, documentCount + 1);
      contextCharacters += contentCharacters;
    }

    return selected;
  }

  private score<T extends RerankableCandidate>(
    query: string,
    candidate: T,
    maxKeywordScore: number,
    maxSemanticScore: number,
  ): number {
    const keywordScore = candidate.keywordScore === null
      ? 0
      : candidate.keywordScore / maxKeywordScore;
    const semanticScore = candidate.semanticScore === null
      ? 0
      : candidate.semanticScore / maxSemanticScore;
    const keywordCoverage = this.keywordCoverage(query, candidate);
    const dualSourceBonus = candidate.sources.includes('keyword')
      && candidate.sources.includes('semantic')
      ? 1
      : 0;

    return (
      semanticScore * 0.5
      + keywordScore * 0.25
      + keywordCoverage * 0.15
      + dualSourceBonus * 0.1
    );
  }

  private keywordCoverage(query: string, candidate: RerankableCandidate): number {
    const tokens = this.tokenize(query);
    if (!tokens.length) {
      return 0;
    }
    const text = [candidate.title, candidate.content ?? '', ...candidate.tags]
      .join(' ')
      .toLowerCase();
    const matched = tokens.filter((token) => text.includes(token));
    return matched.length / tokens.length;
  }

  private tokenize(value: string): string[] {
    return [...new Set(value.toLowerCase().match(/[a-z0-9]+|[\u4e00-\u9fff]/gi) ?? [])];
  }

  private maxScore(scores: number[]): number {
    const max = Math.max(...scores, 0);
    return max > 0 ? max : 1;
  }
}
