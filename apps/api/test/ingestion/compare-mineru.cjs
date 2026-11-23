const os = require('node:os');
const { readFile, mkdir, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { execFileSync } = require('node:child_process');
const { ConfigService } = require('@nestjs/config');
const { fixtures } = require('./fixtures.cjs');
const { parserRuntime, load } = require('./runtime.cjs');

async function run() {
  if (!process.env.MINERU_BASE_URL)
    throw new Error(
      'Set MINERU_BASE_URL to an explicitly chosen MinerU v4 service.',
    );
  const repeats = Number(process.env.MINERU_BENCHMARK_REPEATS || 1);
  if (!Number.isSafeInteger(repeats) || repeats < 1 || repeats > 20)
    throw new Error('Invalid MINERU_BENCHMARK_REPEATS');
  const manifestPath = process.argv[2];
  const samples = manifestPath
    ? await Promise.all(
        JSON.parse(await readFile(manifestPath, 'utf8')).map(async (item) => ({
          ...item,
          name: path.basename(item.path),
          data: await readFile(
            path.resolve(path.dirname(manifestPath), item.path),
          ),
        })),
      )
    : (await fixtures()).filter(
        (sample) => !['.md', '.txt'].includes(path.extname(sample.name)),
      );
  const { MarkdownChunkerService } = load(
    'pipeline/chunk/markdown-chunker.service.js',
  );
  const chunker = new MarkdownChunkerService(new ConfigService());
  const engines = {
    native: parserRuntime(),
    mineru: parserRuntime({
      DOCUMENT_PARSER: 'mineru',
      MINERU_BASE_URL: process.env.MINERU_BASE_URL,
      MINERU_API_KEY: process.env.MINERU_API_KEY || '',
      MINERU_TIER: process.env.MINERU_TIER || 'standard',
      MINERU_TIMEOUT_MS: process.env.MINERU_TIMEOUT_MS || '600000',
      MINERU_TRANSFER_ORIGINS: process.env.MINERU_TRANSFER_ORIGINS || '',
    }),
  };
  const report = {
    revision: execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim(),
    workingTreeDirty: Boolean(
      execFileSync('git', ['status', '--porcelain'], {
        encoding: 'utf8',
      }).trim(),
    ),
    scope: manifestPath
      ? 'Caller-supplied annotated corpus'
      : 'Synthetic fixtures; not production quality evidence',
    tier: process.env.MINERU_TIER || 'standard',
    createdAt: new Date().toISOString(),
    repeats,
    node: process.version,
    platform: os.platform(),
    arch: os.arch(),
    cpu: os.cpus()[0]?.model,
    factMatching: 'literal substring of each complete annotated statement',
    pollMs: 1000,
    results: [],
  };
  for (let run = 1; run <= repeats; run++) {
    for (const fixture of samples) {
      for (const [engine, runtime] of Object.entries(engines)) {
        const start = performance.now();
        try {
          const result = await runtime.parser.parse(
            fixture.data,
            fixture.name,
            'comparison',
          );
          const parsedMs = performance.now() - start;
          const chunks = result.ready
            ? await chunker.splitStructured(result.markdown, result.sections)
            : [];
          const facts = fixture.facts || [];
          const ordering = fixture.order || [];
          const positions = ordering.map((text) =>
            result.markdown.indexOf(text),
          );
          report.results.push({
            run,
            sample: fixture.name,
            sha256: createHash('sha256').update(fixture.data).digest('hex'),
            engine,
            ready: result.ready,
            expectedReady: fixture.expectedReady ?? !fixture.invalid,
            facts: facts.length,
            parsedFacts: facts.filter((text) => result.markdown.includes(text))
              .length,
            chunkedFacts: facts.filter((text) =>
              chunks.some((chunk) => chunk.content.includes(text)),
            ).length,
            orderedEvidence: ordering.length
              ? positions.every(
                  (pos, i) => pos >= 0 && (i === 0 || pos > positions[i - 1]),
                )
              : null,
            parseMs: parsedMs,
            totalMs: performance.now() - start,
            chunks: chunks.length,
            provenance: result.provenance,
            quality: result.quality?.status,
            issueCodes: result.quality?.issues.map((issue) => issue.code),
          });
        } catch {
          report.results.push({
            run,
            sample: fixture.name,
            engine,
            failed: true,
            totalMs: performance.now() - start,
          });
        }
      }
    }
  }
  const directory = path.resolve(
    __dirname,
    '../../../../reports/ingestion-mineru',
  );
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, 'comparison.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  console.table(report.results);
  if (
    report.results.some(
      (result) =>
        result.failed ||
        result.ready !== result.expectedReady ||
        result.orderedEvidence === false ||
        (result.ready && result.chunkedFacts !== result.facts),
    )
  )
    process.exitCode = 1;
}
run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
