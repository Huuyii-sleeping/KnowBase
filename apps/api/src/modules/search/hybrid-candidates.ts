import type { SemanticSearchItem } from '../rag/rag-query.service';
import type { RerankableCandidate } from '../retrieval/rerank/rerank.types';
import type { HybridSearchItem } from './hybrid-search.service';

export const HYBRID_RETRIEVAL_POLICY = {
  keywordUnit: 'active RAG chunk content',
  mergeUnit: 'chunk ID',
  candidateMultiplier: 1,
  maxCandidatesPerRoute: 60,
} as const;

export function hybridCandidateCount(topK: number): number {
  return Math.min(
    topK * HYBRID_RETRIEVAL_POLICY.candidateMultiplier,
    HYBRID_RETRIEVAL_POLICY.maxCandidatesPerRoute,
  );
}

/** Document matches must not give an unrelated paragraph a keyword boost. */
export function mergeChunkCandidates(
  keywordItems: SemanticSearchItem[],
  semanticItems: SemanticSearchItem[],
): Array<HybridSearchItem & RerankableCandidate> {
  const keywords = new Map(keywordItems.map((item) => [item.chunkId, item]));
  const semantics = new Map(semanticItems.map((item) => [item.chunkId, item]));
  const chunks = new Map([...keywords, ...semantics]);
  const maxKeyword =
    Math.max(0, ...keywordItems.map((item) => item.score ?? 0)) || 1;
  const maxSemantic =
    Math.max(0, ...semanticItems.map((item) => item.score ?? 0)) || 1;
  return [...chunks.values()].map((item) => {
    const keywordScore = keywords.get(item.chunkId)?.score ?? null;
    const semanticScore = semantics.get(item.chunkId)?.score ?? null;
    return {
      documentId: item.documentId,
      chunkId: item.chunkId,
      chunkIndex: item.chunkIndex,
      content: item.content,
      ...item.document,
      keywordScore,
      semanticScore,
      sources: [
        ...(keywords.has(item.chunkId) ? ['keyword' as const] : []),
        ...(semantics.has(item.chunkId) ? ['semantic' as const] : []),
      ],
      score:
        ((keywordScore ?? 0) / maxKeyword) * 0.4 +
        ((semanticScore ?? 0) / maxSemantic) * 0.6,
      rerankScore: 0,
    };
  });
}
