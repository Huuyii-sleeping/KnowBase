const dimensions = [
  'visible',
  'critical',
  'visualCritical',
  'sources',
  'relations',
  'unknown',
  'readingOrder',
  'tables',
];
function summarize(cases) {
  const groups = {};
  for (const row of cases) {
    const key = `${row.split}/${row.category}`;
    const group = (groups[key] ??= {
      attempted: 0,
      completed: 0,
      unavailable: 0,
      failed: 0,
      errors: {},
      metrics: {},
      elapsedMs: 0,
    });
    group.attempted++;
    group[row.status]++;
    if (row.elapsedMs !== undefined) group.elapsedMs += row.elapsedMs;
    if (!row.score) continue;
    for (const dimension of dimensions) {
      const value = row.score[dimension];
      const metric = (group.metrics[dimension] ??= { matched: 0, expected: 0 });
      metric.matched += value.matched;
      metric.expected += value.expected;
    }
    for (const error of row.score.errors)
      group.errors[error.type] = (group.errors[error.type] || 0) + 1;
  }
  return groups;
}
function compare(before, after) {
  if (
    before.schema !== 'complex-quality-run-v1' ||
    after.schema !== before.schema ||
    !before.manifestSha256 ||
    before.manifestSha256 !== after.manifestSha256 ||
    !before.goldSha256 ||
    before.goldSha256 !== after.goldSha256 ||
    !before.scorerSha256 ||
    before.scorerSha256 !== after.scorerSha256 ||
    !before.budgets ||
    !after.budgets ||
    JSON.stringify(before.budgets) !== JSON.stringify(after.budgets) ||
    !before.cases.length ||
    before.cases.length !== after.cases.length ||
    new Set(before.cases.map((x) => x.id)).size !== before.cases.length ||
    new Set(after.cases.map((x) => x.id)).size !== after.cases.length
  )
    throw new Error(
      'Comparison requires the same corpus, gold, scorer, budgets and unique case set',
    );
  return after.cases.map((row) => {
    const old = before.cases.find((x) => x.id === row.id);
    if (
      !old ||
      !old.inputSha256 ||
      !old.category ||
      !old.split ||
      old.inputSha256 !== row.inputSha256 ||
      old.category !== row.category ||
      old.split !== row.split
    )
      throw new Error('Comparison case identity differs');
    const comparable = old.status === 'completed' && row.status === 'completed';
    return {
      id: row.id,
      comparable,
      beforeStatus: old.status,
      afterStatus: row.status,
      delta: comparable
        ? Object.fromEntries(
            dimensions.map((d) => {
              if (old.score[d].expected !== row.score[d].expected)
                throw new Error('Comparison denominator differs');
              return [d, row.score[d].matched - old.score[d].matched];
            }),
          )
        : null,
    };
  });
}
module.exports = { summarize, compare };
