// Offline comparisons only. No questions, labels, or corpus-specific rules.
const STRATEGIES = [
  { id: 'rule', kind: 'rule' },
  { id: 'rrf', kind: 'rrf', constant: 60 },
  { id: 'rule-no-dual', kind: 'no-dual' },
  { id: 'rule-diverse', kind: 'diverse', relevance: 0.85 },
  { id: 'keyword-first', kind: 'route', route: 'keyword', diagnostic: true },
  { id: 'semantic-first', kind: 'route', route: 'semantic', diagnostic: true },
  {
    id: 'rule-doc-cap5',
    kind: 'rule',
    maxChunksPerDocument: 5,
    diagnostic: true,
  },
  {
    id: 'rule-char12000',
    kind: 'rule',
    maxContextCharacters: 12000,
    diagnostic: true,
  },
  { id: 'rule-top10', kind: 'rule', topK: 10, diagnostic: true },
];

function grams(text) {
  const value = text.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
  if (!value) return new Set();
  if (value.length < 3) return new Set([value]);
  return new Set(
    Array.from({ length: value.length - 2 }, (_, i) => value.slice(i, i + 3)),
  );
}

function similarity(a, b) {
  if (!a.size && !b.size) return 0;
  const intersection = [...a].filter((g) => b.has(g)).length;
  return intersection / (a.size + b.size - intersection);
}

// Mirrors the production constraints, retaining why each candidate was skipped.
// Every baseline replay is checked against the real RerankService output.
function selectRanked(
  ranked,
  {
    topK = 5,
    maxChunksPerDocument = 2,
    maxContextCharacters = 6000,
    relevance,
  } = {},
) {
  const remaining = [...ranked];
  const selected = [];
  const decisions = [];
  const documents = new Map();
  const features =
    relevance === undefined
      ? null
      : new Map(
          ranked.map((item) => [item.chunkId, grams(item.content ?? '')]),
        );
  let characters = 0;
  while (remaining.length) {
    let index = 0;
    if (relevance !== undefined && selected.length && selected.length < topK) {
      let best = -Infinity;
      remaining.forEach((item, i) => {
        const redundancy = Math.max(
          ...selected.map((s) =>
            similarity(features.get(item.chunkId), features.get(s.chunkId)),
          ),
        );
        const score =
          relevance * item.rerankScore - (1 - relevance) * redundancy;
        if (score > best) {
          best = score;
          index = i;
        }
      });
    }
    const [item] = remaining.splice(index, 1);
    const length = item.content?.length ?? 0;
    const reason =
      selected.length >= topK
        ? 'top_k'
        : (documents.get(item.documentId) ?? 0) >= maxChunksPerDocument
          ? 'document_cap'
          : length > 0 &&
              characters + length > maxContextCharacters &&
              selected.length > 0
            ? 'character_budget'
            : 'selected';
    decisions.push({
      chunkId: item.chunkId,
      rank: ranked.indexOf(item) + 1,
      score: item.rerankScore,
      reason,
    });
    if (reason === 'selected') {
      selected.push(item);
      characters += length;
      documents.set(item.documentId, (documents.get(item.documentId) ?? 0) + 1);
    }
  }
  return { selected, decisions, characters };
}

function rankStrategy(ruleRanked, trace, strategy) {
  const ranks = Object.fromEntries(
    ['keyword', 'semantic'].map((route) => [
      route,
      new Map(trace[route].items.map((item, i) => [item.chunkId, i + 1])),
    ]),
  );
  return ruleRanked
    .map((item) => {
      let score = item.rerankScore;
      if (strategy.kind === 'rrf') {
        score = ['keyword', 'semantic'].reduce(
          (sum, route) =>
            sum +
            (ranks[route].has(item.chunkId)
              ? 1 / (strategy.constant + ranks[route].get(item.chunkId))
              : 0),
          0,
        );
      } else if (strategy.kind === 'no-dual') {
        if (
          item.sources.includes('keyword') &&
          item.sources.includes('semantic')
        )
          score -= 0.1;
      } else if (strategy.kind === 'route') {
        const other = strategy.route === 'keyword' ? 'semantic' : 'keyword';
        score = ranks[strategy.route].has(item.chunkId)
          ? 1 + 1 / ranks[strategy.route].get(item.chunkId)
          : 1 / (1 + ranks[other].get(item.chunkId));
      }
      return { ...item, rerankScore: score };
      // Stable ties retain the merged pool order, matching the production rule.
    })
    .sort((a, b) => b.rerankScore - a.rerankScore);
}

module.exports = { STRATEGIES, grams, similarity, selectRanked, rankStrategy };
