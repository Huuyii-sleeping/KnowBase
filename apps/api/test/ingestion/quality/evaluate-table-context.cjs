const path = require('node:path');
const { readFile, mkdir, writeFile } = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const { ConfigService } = require('@nestjs/config');
const { load, parserRuntime } = require('../runtime.cjs');
const { loadCorpus, digest } = require('./corpus.cjs');
const { tableContext } = require('./table-context.cjs');
async function evaluate(directory, annotationFile, destination) {
  if (!process.env.MINERU_BASE_URL)
    throw new Error('Explicit MINERU_BASE_URL required');
  const corpus = await loadCorpus(directory);
  const annotationBytes = await readFile(annotationFile);
  const annotations = JSON.parse(annotationBytes);
  const report = {
    status: 'running',
    scope:
      'Real parsing and chunking; exact row/header binding and source ranges, not retrieval accuracy.',
    manifestSha256: corpus.manifestSha256,
    annotationSha256: digest(annotationBytes),
    cases: [],
  };
  await mkdir(destination, { recursive: true });
  try {
    for (const gold of annotations) {
      const fixture = corpus.cases.find(
        (item) => item.kind === 'document' && item.file === gold.file,
      );
      if (!fixture) throw new Error('Missing annotated table fixture');
      const { parser } = parserRuntime({
        DOCUMENT_PARSER: 'mineru',
        MINERU_BASE_URL: process.env.MINERU_BASE_URL,
      });
      const parsed = await parser.parse(
        await readFile(path.join(corpus.root, fixture.file)),
        fixture.file,
        randomUUID(),
      );
      const table = parsed.blocks.filter((block) => block.table)[gold.table]
        ?.table;
      for (const budget of [180, 256, 1000]) {
        const Chunker = load(
          'pipeline/chunk/markdown-chunker.service.js',
        ).MarkdownChunkerService;
        const chunks = await new Chunker(
          new ConfigService({ RAG_CHUNK_SIZE: budget, RAG_CHUNK_OVERLAP: 0 }),
        ).splitStructured(parsed.markdown, parsed.sections);
        const score = tableContext(chunks, table?.id, gold);
        report.cases.push({
          file: fixture.file,
          inputSha256: fixture.sha256,
          budget,
          chunks: chunks.length,
          ...score,
          passed:
            score.matched === score.expected &&
            chunks.every((chunk) => chunk.content.length <= budget),
        });
      }
    }
    report.status =
      report.cases.length && report.cases.every((row) => row.passed)
        ? 'passed'
        : 'failed';
    return report;
  } finally {
    if (report.status === 'running') report.status = 'failed';
    await writeFile(
      path.join(destination, 'table-context.json'),
      JSON.stringify(report, null, 2) + '\n',
    );
  }
}
if (require.main === module)
  evaluate(
    path.resolve(process.argv[2]),
    path.resolve(
      process.argv[3] ||
        path.join(
          __dirname,
          '../../../../../benchmarks/ingestion-business/table-context.json',
        ),
    ),
    path.resolve(
      process.argv[4] ||
        path.join(__dirname, '../../../../../reports/ingestion-quality-v2'),
    ),
  )
    .then((report) => {
      console.table(report.cases);
      if (report.status !== 'passed') process.exitCode = 1;
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
