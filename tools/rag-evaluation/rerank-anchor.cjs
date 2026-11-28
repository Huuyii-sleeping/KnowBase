// One fixed composition, not a query-specific fallback or a score blend.
const { selectRanked } = require("./rerank-policies.cjs");

function reserveRuleAnchors(
  row,
  modelResult,
  { anchorCount = 2, ...constraints } = {},
) {
  if (
    !Number.isInteger(anchorCount) ||
    anchorCount < 0 ||
    anchorCount > (constraints.topK ?? 5)
  ) {
    throw new Error("Invalid anchor count");
  }
  if (
    modelResult.scores.length !== row.pool.length ||
    modelResult.scores.some((s) => !Number.isFinite(s))
  ) {
    throw new Error("Incomplete or nonfinite model scores");
  }
  const scored = row.pool.map((item, i) => ({
    ...item,
    rerankScore: modelResult.scores[i],
  }));
  const byId = new Map(scored.map((item) => [item.chunkId, item]));
  if (
    byId.size !== row.pool.length ||
    row.options.rule.selected.some((id) => !byId.has(id))
  ) {
    throw new Error("Invalid baseline or duplicate pool");
  }
  const anchors = row.options.rule.selected.slice(0, anchorCount);
  const anchorSet = new Set(anchors);
  const ranked = [
    ...anchors.map((id) => byId.get(id)),
    ...scored
      .filter((item) => !anchorSet.has(item.chunkId))
      .sort((a, b) => b.rerankScore - a.rerankScore),
  ];
  const result = selectRanked(ranked, constraints);
  return {
    selected: result.selected.map((item) => item.chunkId),
    decisions: result.decisions.map((item) => ({
      ...item,
      ruleAnchor: anchorSet.has(item.chunkId),
    })),
    characters: result.characters,
    anchors,
  };
}

module.exports = { reserveRuleAnchors };
