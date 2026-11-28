const path = require('node:path');
const { readFile, mkdir, writeFile } = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const { loadCorpus } = require('./corpus.cjs');
const { scoreDocument } = require('./metrics.cjs');
const { parserRuntime } = require('../runtime.cjs');
async function evaluate(directory, destination) {
  if (!process.env.MINERU_BASE_URL)
    throw new Error('Explicit MINERU_BASE_URL is required');
  const corpus = await loadCorpus(directory);
  const report = {
    schema: 'ingestion-quality-report-v1',
    generatedAt: new Date().toISOString(),
    provenance: corpus.provenance,
    manifestSha256: corpus.manifestSha256,
    scope:
      'Real document parsing. Asset uploader is an in-memory adapter; use QUALITY_CORPUS with verify-evidence.cjs for real persistence.',
    status: 'running',
    cases: [],
  };
  await mkdir(destination, { recursive: true });
  try {
    for (const item of corpus.cases.filter(
      (item) => item.kind === 'document',
    )) {
      const { parser } = parserRuntime({
        DOCUMENT_PARSER: 'mineru',
        MINERU_BASE_URL: process.env.MINERU_BASE_URL,
      });
      const started = performance.now();
      try {
        const result = await parser.parse(
          await readFile(path.join(corpus.root, item.file)),
          item.file,
          randomUUID(),
        );
        report.cases.push({
          id: item.id,
          split: item.split,
          inputSha256: item.sha256,
          provenance: result.provenance,
          ready: result.ready,
          elapsedMs: performance.now() - started,
          ...scoreDocument(result, item),
        });
      } catch (error) {
        report.cases.push({
          id: item.id,
          split: item.split,
          inputSha256: item.sha256,
          elapsedMs: performance.now() - started,
          passed: false,
          error: error.message,
        });
      }
    }
    report.status =
      report.cases.length && report.cases.every((item) => item.passed)
        ? 'passed'
        : 'failed';
    return report;
  } finally {
    if (report.status === 'running') report.status = 'failed';
    await writeFile(
      path.join(destination, 'documents.json'),
      JSON.stringify(report, null, 2) + '\n',
    );
  }
}
if (require.main === module)
  evaluate(
    path.resolve(process.argv[2]),
    path.resolve(
      process.argv[3] ||
        path.resolve(__dirname, '../../../../../reports/ingestion-quality'),
    ),
  )
    .then((report) => {
      console.table(
        report.cases.map((x) => ({
          id: x.id,
          passed: x.passed,
          facts: x.facts ? `${x.facts.matched}/${x.facts.expected}` : '',
          cells: x.tables
            ? `${x.tables.matchedCells}/${x.tables.expectedCells}`
            : '',
          error: x.error,
        })),
      );
      if (report.status !== 'passed') process.exitCode = 1;
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
module.exports = { evaluate };
