const { test } = require('node:test');
const assert = require('node:assert/strict');
const { compare } = require('./compare-documents.cjs');
test('comparisons refuse changed corpus, mismatched files and duplicate cases', () => {
  const before = {
    manifestSha256: 'fixed',
    provenance: 'synthetic',
    cases: [
      {
        id: 'case',
        inputSha256: 'a',
        passed: false,
        tables: { matchedCells: 9 },
      },
    ],
  };
  const after = {
    ...before,
    cases: [
      {
        id: 'case',
        inputSha256: 'a',
        passed: true,
        tables: { matchedCells: 15, expectedCells: 15 },
      },
    ],
  };
  assert.equal(compare(before, after).cases[0].afterCells, 15);
  assert.throws(
    () => compare(before, { ...after, manifestSha256: 'other' }),
    /identical/,
  );
  assert.throws(
    () =>
      compare(before, {
        ...after,
        cases: [{ ...after.cases[0], inputSha256: 'b' }],
      }),
    /hashes/,
  );
  assert.throws(
    () =>
      compare(
        { ...before, cases: [...before.cases, ...before.cases] },
        { ...after, cases: [...after.cases, ...after.cases] },
      ),
    /unique/,
  );
});
