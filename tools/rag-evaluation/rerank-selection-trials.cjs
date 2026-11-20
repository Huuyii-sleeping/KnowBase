// Offline selection experiments. No labels, query-specific rules or model calls.
const { grams, similarity } = require("./rerank-policies.cjs");
const { selectVariant } = require("./rerank-refinement.cjs");

function facts(text) {
  return JSON.stringify(
    [
      ...new Set(
        text
          .normalize("NFKC")
          .toLowerCase()
          .match(
            /[a-z0-9]+(?:[._%-][a-z0-9]+)*|不得|禁止|必须|仅|不|未|无|除|现行|历史|失效|之前|之后/g,
          ) ?? [],
      ),
    ].sort(),
  );
}

function isDuplicate(left, right, threshold) {
  const a = left.content ?? "",
    b = right.content ?? "";
  return (
    Boolean(a.trim() && b.trim()) &&
    facts(a) === facts(b) &&
    similarity(grams(a), grams(b)) >= threshold
  );
}

function selectTrial(row, scores, variant, constraints) {
  if (
    scores.length !== row.pool.length ||
    scores.some((s) => !Number.isFinite(s))
  )
    throw new Error("Incomplete or nonfinite scores");
  if (new Set(row.pool.map((p) => p.chunkId)).size !== row.pool.length)
    throw new Error("Duplicate candidate identities");
  if (variant.kind === "control" || variant.kind === "model")
    return selectVariant(row, scores, {}, constraints);
  if (!["dedup", "threshold"].includes(variant.kind))
    throw new Error("Unknown trial kind");
  if (
    variant.kind === "dedup" &&
    !(variant.similarity > 0 && variant.similarity <= 1)
  )
    throw new Error("Invalid duplicate threshold");
  if (variant.kind === "threshold" && !Number.isFinite(variant.minScore))
    throw new Error("Invalid score threshold");
  const byId = new Map(
    row.pool.map((p, i) => [p.chunkId, { ...p, score: scores[i] }]),
  );
  const anchors = row.options.rule.selected.slice(0, 2);
  if (anchors.some((id) => !byId.has(id))) throw new Error("Foreign anchor");
  const anchorSet = new Set(anchors);
  const admission = [
    ...anchors.map((id) => byId.get(id)),
    ...[...byId.values()]
      .filter((p) => !anchorSet.has(p.chunkId))
      .sort((a, b) => b.score - a.score),
  ];
  const selected = [],
    decisions = [],
    counts = new Map();
  let characters = 0;
  for (const item of admission) {
    const size = item.content?.length ?? 0;
    const duplicate =
      variant.kind === "dedup" &&
      selected.find((p) => isDuplicate(item, p, variant.similarity));
    const reason =
      variant.kind === "threshold" && item.score < variant.minScore
        ? "weak_score"
        : duplicate
          ? "near_duplicate"
          : selected.length >= constraints.topK
            ? "top_k"
            : (counts.get(item.documentId) ?? 0) >=
                constraints.maxChunksPerDocument
              ? "document_cap"
              : size > 0 &&
                  characters + size > constraints.maxContextCharacters &&
                  selected.length > 0
                ? "character_budget"
                : "selected";
    decisions.push({
      chunkId: item.chunkId,
      score: item.score,
      reason,
      ...(duplicate ? { duplicateOf: duplicate.chunkId } : {}),
    });
    if (reason !== "selected") continue;
    selected.push(item);
    characters += size;
    counts.set(item.documentId, (counts.get(item.documentId) ?? 0) + 1);
  }
  return {
    selected: selected.sort((a, b) => b.score - a.score).map((p) => p.chunkId),
    decisions,
    characters,
    anchors,
  };
}

module.exports = { facts, isDuplicate, selectTrial };
