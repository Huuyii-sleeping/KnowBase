const { queryMode, planQueries } = require('./multi-intent.cjs');

// This only schedules candidates inside one recall route. The existing
// keyword/vector merge and final ranking remain unchanged.
function weaveCandidates(lists, limit, idOf) {
  const order = lists.length === 1 ? [0] : [0, 0, 1, 2];
  const positions = lists.map(() => 0),
    seen = new Set(),
    result = [];
  while (result.length < limit) {
    let added = false;
    for (const route of order) {
      const list = lists[route];
      if (!list) continue;
      while (positions[route] < list.length) {
        const candidate = list[positions[route]++],
          id = idOf(candidate);
        if (seen.has(id)) continue;
        seen.add(id);
        result.push(candidate);
        added = true;
        break;
      }
      if (result.length >= limit) break;
    }
    if (!added) break;
  }
  return result;
}

async function recallIntents(recall, query, topK, route, user, mode = 'off') {
  queryMode(mode);
  const enabled =
    mode === 'clauses-both' ||
    (mode === 'clauses-keyword' && route === 'keyword');
  const plan = planQueries(query, topK, enabled);
  if (plan.length === 1) {
    const trace = await recall.recall({ query, topK }, route, user);
    return { ...trace, queryPlan: plan };
  }
  const started = performance.now();
  const traces = await Promise.all(
    plan.map((p) =>
      recall.recall({ query: p.query, topK: p.budget }, route, user),
    ),
  );
  if (traces.some((t) => !Array.isArray(t.eligibleCandidates)))
    throw new Error(
      'Multi-intent recall requires complete eligibility diagnostics',
    );
  const rawLimit = Math.min(topK * 3, 100);
  const rawCandidates = weaveCandidates(
    traces.map((t) => t.rawCandidates),
    rawLimit,
    (c) => c.id,
  );
  const eligibleCandidates = weaveCandidates(
    traces.map((t) => t.eligibleCandidates),
    rawLimit,
    (c) => c.chunkId,
  );
  return {
    query,
    topK,
    route,
    rawCandidates,
    eligibleCandidates,
    items: eligibleCandidates.slice(0, topK),
    elapsedMs: performance.now() - started,
    // Summed work duration, not wall-clock latency: branches execute concurrently.
    timings: Object.fromEntries(
      ['visibilityMs', 'embeddingMs', 'indexMs', 'metadataMs'].map((key) => [
        key,
        traces.reduce((sum, t) => sum + (t.timings?.[key] || 0), 0),
      ]),
    ),
    queryPlan: plan.map((p, i) => ({
      ...p,
      rawCount: traces[i].rawCandidates.length,
      eligibleCount: traces[i].eligibleCandidates.length,
    })),
    branchWorkMs: traces.reduce((sum, t) => sum + t.elapsedMs, 0),
    timingScope: 'branch timings are summed work; elapsedMs is route wall time',
  };
}

module.exports = { weaveCandidates, recallIntents };
