const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { mkdir, writeFile } = require('node:fs/promises');
const { createHash } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const path = require('node:path');
const { ConfigService } = require('@nestjs/config');
const { fixtures } = require('./fixtures.cjs');
const { legacyRuntime } = require('./legacy-runtime.cjs');
const { parserRuntime, load } = require('./runtime.cjs');

const config = { RAG_CHUNK_SIZE: 300, RAG_CHUNK_OVERLAP: 40 };
const repeats = 20;
const warmups = 2;
function summary(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    runs: values.length,
    medianMs: (sorted[9] + sorted[10]) / 2,
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
    rawMs: values,
  };
}
function structure(chunks) {
  const tables = chunks.filter((text) => /\| 项目\d*\s*\|/.test(text));
  const codes = chunks.filter((text) => /const value\d+/.test(text));
  return {
    tableParts: tables.length,
    tablePartsWithHeader: tables.filter((text) =>
      /\| 项目\s*\| 金额/.test(text),
    ).length,
    codeParts: codes.length,
    codePartsWithFences: codes.filter((text) => /```ts[\s\S]*```/.test(text))
      .length,
  };
}
function tableRows(markdown) {
  return markdown
    .split('\n')
    .filter((line) => line.trim().startsWith('|'))
    .map((line) =>
      line
        .trim()
        .slice(1, -1)
        .split('|')
        .map((cell) => cell.trim()),
    );
}
async function run() {
  const old = legacyRuntime(process.argv[2] || '955f1e1', config);
  try {
    const { MarkdownChunkerService } = load(
      'pipeline/chunk/markdown-chunker.service.js',
    );
    const engines = {
      before: old,
      after: {
        ...parserRuntime(),
        chunker: new MarkdownChunkerService(new ConfigService(config)),
      },
    };
    const report = {
      createdAt: new Date().toISOString(),
      baselineRevision: old.revision,
      currentRevision: execFileSync('git', ['rev-parse', 'HEAD'], {
        encoding: 'utf8',
      }).trim(),
      workingTreeDirty: Boolean(
        execFileSync('git', ['status', '--porcelain'], {
          encoding: 'utf8',
        }).trim(),
      ),
      node: process.version,
      platform: os.platform(),
      arch: os.arch(),
      cpu: os.cpus()[0]?.model,
      config,
      repeats,
      warmups,
      scope:
        'Same synthetic bytes; actual baseline source; paired alternating runs; fresh Buffer.from copies (small inputs use Node buffer pool). Timings include parse/fallback and in-memory normalization, not DB/model/storage. Chunk quality measured even on non-ready bodies; admission reported separately. No production throughput or OCR conclusions.',
      samples: [],
    };
    for (const fixture of await fixtures()) {
      const entries = {};
      for (let iteration = -warmups; iteration < repeats; iteration++) {
        const order =
          iteration % 2 === 0 ? ['before', 'after'] : ['after', 'before'];
        for (const name of order) {
          const engine = engines[name];
          const start = performance.now();
          const parsed = await engine.parser.parse(
            Buffer.from(fixture.data),
            fixture.name,
            'benchmark',
          );
          const parseMs = performance.now() - start;
          const chunkStart = performance.now();
          const chunks =
            name === 'before'
              ? await engine.chunker.split(parsed.markdown)
              : (
                  await engine.chunker.splitStructured(
                    parsed.markdown,
                    parsed.sections,
                  )
                ).map((x) => x.content);
          const chunkMs = performance.now() - chunkStart;
          const entry = (entries[name] ??= {
            parser: parsed.parser,
            ready: parsed.ready,
            parsedFacts: fixture.facts.filter((f) =>
              parsed.markdown.includes(f),
            ).length,
            chunkedFacts: fixture.facts.filter((f) =>
              chunks.some((c) => c.includes(f)),
            ).length,
            structure: structure(chunks),
            chunks: chunks.length,
            maxChunkCharacters: Math.max(0, ...chunks.map((c) => c.length)),
            sourceSections: parsed.sections?.length || 0,
            docxExpectedRows: fixture.name.endsWith('.docx') ? 2 : undefined,
            docxPreservedRows: fixture.name.endsWith('.docx')
              ? [
                  ['项目', '状态'],
                  ['索引', '就绪'],
                ].filter((row) =>
                  tableRows(parsed.markdown).some(
                    (r) => JSON.stringify(r) === JSON.stringify(row),
                  ),
                ).length
              : undefined,
            parse: [],
            chunk: [],
            outcomes: [],
          });
          if (iteration >= 0) {
            entry.parse.push(parseMs);
            entry.chunk.push(chunkMs);
            entry.outcomes.push({
              ready: parsed.ready,
              parser: parsed.parser,
              parsedFacts: fixture.facts.filter((f) =>
                parsed.markdown.includes(f),
              ).length,
              chunkedFacts: fixture.facts.filter((f) =>
                chunks.some((c) => c.includes(f)),
              ).length,
            });
          }
        }
      }
      for (const entry of Object.values(entries)) {
        entry.parse = summary(entry.parse);
        entry.chunk = summary(entry.chunk);
      }
      report.samples.push({
        sample: fixture.name,
        bytes: fixture.data.length,
        sha256: createHash('sha256').update(fixture.data).digest('hex'),
        facts: fixture.facts.length,
        expectedReady: !fixture.invalid,
        ...entries,
      });
    }
    const directory = path.resolve(
      __dirname,
      '../../../../reports/ingestion-comparison',
    );
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, 'native-before-after.json'),
      JSON.stringify(report, null, 2) + '\n',
    );
    console.table(
      report.samples.map((s) => ({
        sample: s.sample,
        facts: s.facts,
        beforeFacts: s.before.chunkedFacts,
        afterFacts: s.after.chunkedFacts,
        beforeReady: s.before.ready,
        afterReady: s.after.ready,
        beforeMedianMs: s.before.parse.medianMs.toFixed(3),
        afterMedianMs: s.after.parse.medianMs.toFixed(3),
        beforeP95Ms: s.before.parse.p95Ms.toFixed(3),
        afterP95Ms: s.after.parse.p95Ms.toFixed(3),
      })),
    );
    console.log('Report:', path.join(directory, 'native-before-after.json'));
    if (
      report.samples.some((s) =>
        s.after.outcomes.some(
          (o) => o.ready !== s.expectedReady || o.chunkedFacts !== s.facts,
        ),
      )
    )
      process.exitCode = 1;
  } finally {
    old.dispose();
  }
}
run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
