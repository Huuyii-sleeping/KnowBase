import { RerankedCandidate } from './rerank.service';
import { RerankableCandidate, RerankOptions } from './rerank.types';

// Reserve membership first; model scores determine final order for all consumers.
export function selectBge<T extends RerankableCandidate>(
  candidates: T[],
  baseline: RerankedCandidate<T>[],
  scores: Map<string, number>,
  options: RerankOptions,
): Array<RerankedCandidate<T> & { rerankModelScore: number }> {
  const anchors = baseline.slice(0, Math.min(2, options.topK));
  const anchorIds = new Set(anchors.map((item) => item.chunkId));
  const ranked = candidates
    .map((item) => ({ ...item, rerankScore: scores.get(item.chunkId!)! }))
    .sort((a, b) => b.rerankScore - a.rerankScore);
  const admission = [
    ...anchors.map((item) => ({
      ...item,
      rerankScore: scores.get(item.chunkId!)!,
    })),
    ...ranked.filter((item) => !anchorIds.has(item.chunkId)),
  ];
  const selected: RerankedCandidate<T>[] = [];
  const counts = new Map<string, number>();
  let characters = 0;
  for (const item of admission) {
    if (selected.length >= options.topK) break;
    if (
      (counts.get(item.documentId) ?? 0) >= (options.maxChunksPerDocument ?? 2)
    )
      continue;
    const size = item.content?.length ?? 0;
    if (
      size > 0 &&
      characters + size > (options.maxContextCharacters ?? 6000) &&
      selected.length > 0
    )
      continue;
    selected.push(item);
    counts.set(item.documentId, (counts.get(item.documentId) ?? 0) + 1);
    characters += size;
  }
  return selected
    .sort((a, b) => b.rerankScore - a.rerankScore)
    .map((item, index) => ({
      ...item,
      rerankModelScore: item.rerankScore,
      // Consumers also mix graph scores in [0,1]. Logits are not comparable to them.
      // This is a stable ordinal score, not a relevance probability.
      rerankScore: (selected.length - index) / (selected.length + 1),
    }));
}
