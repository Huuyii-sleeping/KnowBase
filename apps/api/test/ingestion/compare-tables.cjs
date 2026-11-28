const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { mkdir, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { ConfigService } = require('@nestjs/config');
const { parserRuntime, load } = require('./runtime.cjs');
const { snapshotChunker } = require('./snapshot-chunker.cjs');
const { tableFixtures } = require('./table-fixtures.cjs');

async function run() {
  if (!process.env.MINERU_BASE_URL)
    throw new Error(
      'Set MINERU_BASE_URL to an explicitly chosen MinerU v4 service',
    );
  const options = { RAG_CHUNK_SIZE: 130, RAG_CHUNK_OVERLAP: 0 };
  const baseline = snapshotChunker(process.argv[2] || '5cd4549', options);
  const { MarkdownChunkerService } = load(
    'pipeline/chunk/markdown-chunker.service.js',
  );
  const { sumTableCells } = load('ingestion/tables/table-sum.js');
  const { parseTable } = load('ingestion/tables/parse-table.js');
  const chunker = new MarkdownChunkerService(new ConfigService(options));
  const report = {
    createdAt: new Date().toISOString(),
    node: process.version,
    baselineRevision: baseline.revision,
    strategy: chunker.strategy,
    repeats: 3,
    scope:
      'Synthetic HTML fixtures, real MinerU Tasks API and adapter. Identical MinerU output goes to both Git baseline and current chunkers. No retrieval, VLM, OCR or production accuracy claim. Asset uploads are memory fakes; persistence is separately integration-tested.',
    options,
    rows: [],
  };
  try {
    for (const fixture of tableFixtures()) {
      const data = Buffer.from(
        `<!doctype html><html><head><meta charset="utf-8"></head><body><h1>${fixture.title}</h1>${fixture.table}</body></html>`,
      );
      for (let iteration = 1; iteration <= report.repeats; iteration++) {
        const { parser } = parserRuntime({
          DOCUMENT_PARSER: 'mineru',
          MINERU_BASE_URL: process.env.MINERU_BASE_URL,
        });
        const started = performance.now();
        const parsed = await parser.parse(
          data,
          fixture.name,
          `table-${iteration}`,
        );
        const parseMs = performance.now() - started;
        assert.equal(parsed.ready, true, parsed.error);
        const tables = parsed.blocks
          .filter((block) => block.table)
          .map((block) => block.table);
        assert.equal(tables.length, 1);
        const table = tables[0];
        assert.equal(table.cells.length, fixture.canonicalCells);
        const original = parseTable(fixture.table);
        assert.deepEqual(table.cells, original.cells);
        assert.deepEqual(table.headerRows, original.headerRows);
        assert.equal(table.rowCount, original.rowCount);
        assert.equal(table.columnCount, original.columnCount);
        const sum = sumTableCells(table, fixture.sum.cells);
        assert.equal(sum.value, fixture.sum.value);
        for (const references of fixture.rejectSum || [])
          assert.throws(() => sumTableCells(table, references));
        const row = {
          name: fixture.name,
          iteration,
          sha256: createHash('sha256').update(data).digest('hex'),
          provenance: parsed.provenance,
          parseMs,
          dataRows: fixture.rows.length,
          canonicalCells: table.cells.length,
          sum: sum.value,
          baseline: {},
          current: {},
        };
        for (const [label, service] of [
          ['baseline', baseline.chunker],
          ['current', chunker],
        ]) {
          const start = performance.now();
          const chunks = await service.splitStructured(
            parsed.markdown,
            parsed.sections,
          );
          const chunksMs = performance.now() - start;
          assert.ok(
            chunks.every(
              (chunk) => chunk.content.length <= options.RAG_CHUNK_SIZE,
            ),
          );
          // Same lexical criterion on both paths: all header labels and all
          // nonempty values in a data row must coexist in a single chunk.
          const contextualRows = fixture.rows.filter((values) =>
            chunks.some((chunk) =>
              [...fixture.headers, ...values].every((value) =>
                chunk.content.includes(value),
              ),
            ),
          ).length;
          const tableRanges = chunks.flatMap((chunk) =>
            chunk.ranges.filter((range) => range.source?.tableId),
          );
          row[label] = {
            chunks: chunks.length,
            chunksMs,
            contextualRows,
            locatedRows: new Set(
              tableRanges.flatMap((range) =>
                Array.from(
                  {
                    length:
                      range.source.tableRowEnd - range.source.tableRowStart + 1,
                  },
                  (_, index) => range.source.tableRowStart + index,
                ),
              ),
            ).size,
          };
          if (label === 'current') {
            assert.equal(contextualRows, fixture.rows.length);
            assert.equal(row[label].locatedRows, fixture.rows.length);
            assert.ok(
              tableRanges.every(
                (range) =>
                  range.source.tableId === table.id &&
                  range.source.partition === 1 &&
                  range.source.blockIndex === 1,
              ),
            );
          }
        }
        report.rows.push(row);
      }
    }
    const directory = path.resolve(
      __dirname,
      '../../../../reports/ingestion-tables',
    );
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, 'comparison.json'),
      JSON.stringify(report, null, 2) + '\n',
    );
    console.table(
      report.rows.map((row) => ({
        name: row.name,
        run: row.iteration,
        rows: row.dataRows,
        before: row.baseline.contextualRows,
        after: row.current.contextualRows,
        located: row.current.locatedRows,
        cells: row.canonicalCells,
        sum: row.sum,
      })),
    );
  } finally {
    baseline.dispose();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
