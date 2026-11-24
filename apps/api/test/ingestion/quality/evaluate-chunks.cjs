const path = require('node:path');
const { readFile, realpath, mkdir, writeFile } = require('node:fs/promises');
const { ConfigService } = require('@nestjs/config');
const { load } = require('../runtime.cjs');
const { digest } = require('./corpus.cjs');
const { scoreChunks } = require('./chunk-evidence.cjs');
const { markdownBlocks } = load('ingestion/markdown-blocks.js');
const tables = load('ingestion/tables/table-view.js');
const { MarkdownChunkerService } = load(
  'pipeline/chunk/markdown-chunker.service.js',
);
async function evaluate(annotationFile, destination) {
  const bytes = await readFile(annotationFile);
  const gold = JSON.parse(bytes);
  if (
    gold.schema !== 'chunk-evidence-v1' ||
    gold.provenance !== 'authored-synthetic-business-v1' ||
    !gold.cases?.length ||
    !gold.budgets?.length ||
    new Set(gold.cases.map((x) => x.id)).size !== gold.cases.length
  )
    throw new Error('Invalid chunk evidence manifest');
  const root = await realpath(path.dirname(annotationFile));
  const report = {
    schema: 'chunk-evidence-report-v1',
    annotationSha256: digest(bytes),
    generatedAt: new Date().toISOString(),
    scope:
      'Authored synthetic Markdown input through the production block reader and chunker. No parser engine, embedding model, retrieval, reranker or Prompt invoked. Holdout fixed before implementation; not production accuracy.',
    cases: [],
  };
  for (const item of gold.cases) {
    if (
      !['development', 'holdout'].includes(item.split) ||
      !item.units?.length ||
      new Set(item.units.map((u) => u.id)).size !== item.units.length ||
      item.units.some(
        (u) =>
          !u.heading ||
          !u.quotes?.length ||
          u.quotes.some((q) => typeof q !== 'string' || !q.trim()),
      )
    )
      throw new Error('Invalid evidence unit');
    const file = await realpath(path.resolve(root, item.file));
    if (!file.startsWith(root + path.sep))
      throw new Error('Evidence fixture escapes corpus');
    const markdown = await readFile(file, 'utf8');
    const blocks = markdownBlocks(markdown);
    for (const size of gold.budgets) {
      const row = {
        id: item.id,
        split: item.split,
        inputSha256: digest(markdown),
        size,
        overlap: gold.overlap,
        expectedUnits: item.units.length,
        expectedQuotes: item.units.reduce((n, u) => n + u.quotes.length, 0),
      };
      const chunker = new MarkdownChunkerService(
        new ConfigService({
          RAG_CHUNK_SIZE: size,
          RAG_CHUNK_OVERLAP: gold.overlap,
        }),
      );
      row.strategy = chunker.strategy;
      try {
        const chunks = await chunker.splitStructured(markdown);
        Object.assign(
          row,
          scoreChunks(markdown, blocks, chunks, item.units, tables),
        );
        row.passed &&=
          chunks.length > 0 &&
          chunks.every((chunk) => chunk.content.length <= size);
      } catch (error) {
        row.passed = false;
        row.error = error.message;
      }
      report.cases.push(row);
    }
  }
  report.status = report.cases.every((row) => row.passed) ? 'passed' : 'failed';
  await mkdir(destination, { recursive: true });
  await writeFile(
    path.join(destination, 'chunks.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  return report;
}
if (require.main === module)
  evaluate(
    path.resolve(
      process.argv[2] ||
        path.join(
          __dirname,
          '../../../../../benchmarks/ingestion-business/chunk-evidence.json',
        ),
    ),
    path.resolve(process.argv[3] || 'reports/ingestion-chunks/current'),
  )
    .then((report) => {
      console.table(
        report.cases.map((row) => ({
          id: row.id,
          size: row.size,
          passed: row.passed,
          quotes: row.preservedQuotes,
          together: row.together,
          cells: row.cells?.covered,
          chunks: row.chunks,
          error: row.error,
        })),
      );
      if (report.status !== 'passed') process.exitCode = 1;
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
module.exports = { evaluate };
