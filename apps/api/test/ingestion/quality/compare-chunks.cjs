const { readFile, writeFile, mkdir } = require('node:fs/promises');
const path = require('node:path');
function summarize(rows) {
  return {
    runs: rows.length,
    passed: rows.filter((row) => row.passed).length,
    failedBuilds: rows.filter((row) => row.error).length,
    evidenceUnits: rows.reduce((n, row) => n + row.expectedUnits, 0),
    together: rows.reduce((n, row) => n + (row.together || 0), 0),
    expectedQuotes: rows.reduce((n, row) => n + row.expectedQuotes, 0),
    preservedQuotes: rows.reduce((n, row) => n + (row.preservedQuotes || 0), 0),
    sourceMatched: rows.reduce((n, row) => n + (row.sourceMatched || 0), 0),
    coveredCells: rows.reduce((n, row) => n + (row.cells?.covered || 0), 0),
    indexedCharacters: rows.reduce(
      (n, row) => n + (row.indexedCharacters || 0),
      0,
    ),
    identicalChunkCharacters: rows.reduce(
      (n, row) => n + (row.identicalChunkCharacters || 0),
      0,
    ),
  };
}
function compare(before, after) {
  if (
    before.schema !== 'chunk-evidence-report-v1' ||
    after.schema !== before.schema ||
    !before.annotationSha256 ||
    before.annotationSha256 !== after.annotationSha256 ||
    !before.cases.length ||
    before.cases.length !== after.cases.length
  )
    throw new Error('Identical annotation manifest and case sets required');
  const key = (row) => JSON.stringify([row.id, row.size, row.overlap]);
  const rows = new Map(before.cases.map((row) => [key(row), row]));
  if (
    rows.size !== before.cases.length ||
    new Set(after.cases.map(key)).size !== after.cases.length
  )
    throw new Error('Duplicate case/configuration');
  for (const row of after.cases) {
    const old = rows.get(key(row));
    if (
      !old ||
      old.inputSha256 !== row.inputSha256 ||
      old.split !== row.split ||
      old.expectedUnits !== row.expectedUnits ||
      old.expectedQuotes !== row.expectedQuotes
    )
      throw new Error('Input hash, split, configuration or evidence differs');
  }
  return {
    schema: 'chunk-evidence-comparison-v1',
    annotationSha256: after.annotationSha256,
    scope:
      'Same synthetic inputs and annotations, production chunker before/after. Failed builds count as zero delivered evidence; no retrieval accuracy claim.',
    results: ['all', 'development', 'holdout'].map((split) => ({
      split,
      before: summarize(
        before.cases.filter((r) => split === 'all' || r.split === split),
      ),
      after: summarize(
        after.cases.filter((r) => split === 'all' || r.split === split),
      ),
    })),
    cases: after.cases.map((row) => ({
      id: row.id,
      size: row.size,
      split: row.split,
      before: rows.get(key(row)).passed,
      after: row.passed,
      regressed: rows.get(key(row)).passed && !row.passed,
    })),
  };
}
if (require.main === module)
  (async () => {
    const result = compare(
      JSON.parse(await readFile(process.argv[2], 'utf8')),
      JSON.parse(await readFile(process.argv[3], 'utf8')),
    );
    const destination = path.resolve(
      process.argv[4] || 'reports/ingestion-chunks/comparison.json',
    );
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result.results, null, 2));
    if (result.cases.some((row) => row.regressed)) process.exitCode = 1;
  })().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
module.exports = { compare };
