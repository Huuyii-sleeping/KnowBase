const path = require('node:path');
const { readFile, mkdir, writeFile } = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const { ConfigService } = require('@nestjs/config');
const { load, parserRuntime } = require('../runtime.cjs');
const { loadCorpus } = require('./corpus.cjs');
const { scoreDocument } = require('./metrics.cjs');
const { tableContext } = require('./table-context.cjs');
const { PdfTableNormalizer } = load(
  'documents/parsing/pdf/pdf-table-normalizer.js',
);
const { MarkdownChunkerService } = load(
  'pipeline/chunk/markdown-chunker.service.js',
);
async function evaluate(directory, destination) {
  if (!process.env.MINERU_BASE_URL)
    throw new Error('Explicit MINERU_BASE_URL required');
  const corpus = await loadCorpus(directory);
  const report = {
    status: 'running',
    manifestSha256: corpus.manifestSha256,
    generatedAt: new Date().toISOString(),
    scope:
      'Same pinned native/scanned PDFs, real MinerU. Baseline disables only the new PDF normalizer in this test process; no production flag. Checks cells, header borrowing/page provenance, chunk binding and review state.',
    cases: [],
  };
  const normalize = PdfTableNormalizer.prototype.normalize;
  await mkdir(destination, { recursive: true });
  try {
    for (const item of corpus.cases) {
      const row = { id: item.id, inputSha256: item.sha256 };
      for (const phase of ['before', 'after']) {
        PdfTableNormalizer.prototype.normalize =
          phase === 'before'
            ? function (content) {
                return { content, issues: [] };
              }
            : normalize;
        const { parser } = parserRuntime({
          DOCUMENT_PARSER: 'mineru',
          MINERU_BASE_URL: process.env.MINERU_BASE_URL,
        });
        const result = await parser.parse(
          await readFile(path.join(corpus.root, item.file)),
          item.file,
          randomUUID(),
        );
        const tables = result.blocks.filter((block) => block.table);
        const chunks = await new MarkdownChunkerService(
          new ConfigService({ RAG_CHUNK_SIZE: 256, RAG_CHUNK_OVERLAP: 0 }),
        ).splitStructured(result.markdown, result.sections);
        const bindings = item.tables.map((gold, index) =>
          tableContext(chunks, tables[index]?.table.id, {
            header: gold.cells
              .filter((cell) => cell[0] === 1)
              .map((cell) => cell[2]),
            rows: [2, 3].map((row) => ({
              row,
              values: gold.cells
                .filter((cell) => cell[0] === row)
                .map((cell) => cell[2]),
            })),
          }),
        );
        const secondTableRanges = chunks
          .flatMap((chunk) => chunk.ranges)
          .filter((range) => range.source?.tableId === tables[1]?.table.id);
        const sourceCorrect =
          tables.length === 2 &&
          tables.every((block, index) => block.source.page === index + 1) &&
          (tables[1]?.source.tableHeaderPage ?? null) ===
            item.expectedHeaderPage &&
          secondTableRanges.length > 0 &&
          secondTableRanges.every(
            (range) =>
              range.source.page === 2 &&
              (range.source.tableHeaderPage ?? null) ===
                item.expectedHeaderPage,
          );
        const reviewCorrect = item.requiredIssues.length
          ? result.ready === false
          : result.ready === true;
        const score = scoreDocument(result, item);
        row[phase] = {
          ...score,
          bindings,
          sourceCorrect,
          reviewCorrect,
          ready: result.ready,
          passed:
            score.passed &&
            sourceCorrect &&
            reviewCorrect &&
            bindings.every((score) => score.expected === score.matched),
        };
        await writeFile(
          path.join(destination, `${item.id}-${phase}.json`),
          JSON.stringify(result, null, 2) + '\n',
        );
      }
      report.cases.push(row);
    }
    report.status = report.cases.every((row) => row.after.passed)
      ? 'passed'
      : 'failed';
    return report;
  } finally {
    PdfTableNormalizer.prototype.normalize = normalize;
    if (report.status === 'running') report.status = 'failed';
    await writeFile(
      path.join(destination, 'pdf-tables.json'),
      JSON.stringify(report, null, 2) + '\n',
    );
  }
}
if (require.main === module)
  evaluate(
    path.resolve(process.argv[2]),
    path.resolve(process.argv[3] || 'reports/ingestion-quality-v3/pdf-tables'),
  )
    .then((report) => {
      console.table(
        report.cases.map((row) => ({
          id: row.id,
          before: row.before.passed,
          after: row.after.passed,
          cells: row.after.tables.matchedCells,
          bindings: row.after.bindings.reduce((n, x) => n + x.matched, 0),
        })),
      );
      if (report.status !== 'passed') process.exitCode = 1;
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
module.exports = { evaluate };
