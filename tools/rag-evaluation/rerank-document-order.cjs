// Offline document-first admission. BGE still orders the final admitted chunks.
const { selectRanked } = require("./rerank-policies.cjs");

function selectDocumentFirst(row, scores, aggregation, constraints) {
  if (!["max", "top2mean"].includes(aggregation))
    throw new Error("Unknown document aggregation");
  if (
    scores.length !== row.pool.length ||
    scores.some((s) => !Number.isFinite(s))
  )
    throw new Error("Invalid model scores");
  const chunks = row.pool.map((p, i) => ({ ...p, rerankScore: scores[i] }));
  const byId = new Map(chunks.map((p) => [p.chunkId, p]));
  if (
    byId.size !== chunks.length ||
    row.options.rule.selected.some((id) => !byId.has(id))
  )
    throw new Error("Invalid candidate identities");
  const groups = new Map();
  for (const p of chunks) {
    if (!groups.has(p.documentId)) groups.set(p.documentId, []);
    groups.get(p.documentId).push(p);
  }
  const documents = [...groups.values()]
    .map((items) => {
      items.sort((a, b) => b.rerankScore - a.rerankScore);
      const top = items.slice(0, aggregation === "max" ? 1 : 2);
      return {
        items,
        score: top.reduce((sum, p) => sum + p.rerankScore, 0) / top.length,
      };
    })
    .sort((a, b) => b.score - a.score);
  const anchors = row.options.rule.selected.slice(
    0,
    Math.min(2, constraints.topK),
  );
  const anchorSet = new Set(anchors);
  const admission = [
    ...anchors.map((id) => byId.get(id)),
    ...documents
      .flatMap((g) => g.items)
      .filter((p) => !anchorSet.has(p.chunkId)),
  ];
  const result = selectRanked(admission, constraints);
  return {
    selected: result.selected
      .sort((a, b) => b.rerankScore - a.rerankScore)
      .map((p) => p.chunkId),
    decisions: result.decisions,
    characters: result.characters,
  };
}

module.exports = { selectDocumentFirst };
