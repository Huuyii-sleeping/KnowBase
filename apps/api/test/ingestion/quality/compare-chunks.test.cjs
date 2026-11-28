const { test } = require('node:test');
const assert = require('node:assert/strict');
const { compare } = require('./compare-chunks.cjs');
const row = {
  id: 'fixture',
  size: 256,
  overlap: 0,
  split: 'holdout',
  inputSha256: 'fixed',
  expectedUnits: 2,
  expectedQuotes: 3,
  passed: false,
  error: 'row too long',
};
const before = {
  schema: 'chunk-evidence-report-v1',
  annotationSha256: 'manifest',
  cases: [row],
};
const after = {
  ...before,
  cases: [
    {
      ...row,
      error: undefined,
      passed: true,
      together: 2,
      preservedQuotes: 3,
      sourceMatched: 2,
    },
  ],
};
test('chunk comparison counts failed builds as zero delivered evidence and preserves grouping', () => {
  const report = compare(before, after);
  assert.equal(report.results[0].before.failedBuilds, 1);
  assert.equal(report.results[0].before.together, 0);
  assert.equal(report.results[0].before.expectedQuotes, 3);
  assert.equal(report.results[0].after.together, 2);
  assert.equal(
    report.results.find((x) => x.split === 'holdout').after.passed,
    1,
  );
  assert.equal(report.cases[0].regressed, false);
  assert.equal(compare(after, before).cases[0].regressed, true);
});
test('chunk comparison rejects changed annotations, files, grouping, budgets and duplicate cases', () => {
  assert.throws(
    () => compare(before, { ...after, annotationSha256: 'changed' }),
    /manifest/,
  );
  for (const patch of [
    { inputSha256: 'changed' },
    { split: 'development' },
    { size: 512 },
    { overlap: 30 },
    { expectedUnits: 3 },
    { expectedQuotes: 4 },
  ]) {
    assert.throws(
      () =>
        compare(before, { ...after, cases: [{ ...after.cases[0], ...patch }] }),
      /differs/,
    );
  }
  assert.throws(
    () =>
      compare(
        { ...before, cases: [row, row] },
        { ...after, cases: [row, row] },
      ),
    /Duplicate/,
  );
});
