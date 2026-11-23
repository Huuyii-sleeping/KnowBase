const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { mkdir, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { parserRuntime } = require('./runtime.cjs');
const { extendedFixtures } = require('./extended-fixtures.cjs');

async function run() {
  const corpus = await extendedFixtures();
  const report = {
    createdAt: new Date().toISOString(),
    node: process.version,
    baselineRevision: execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim(),
    workingTreeDirty: true,
    converterVersion: corpus.converterVersion,
    scope:
      'Real MinerU Tasks API; legacy OLE fixtures generated from synthetic modern Office. Three runs per input, including invalid files and HTML external-image review. LibreOffice is fixture generation only. No production corpus accuracy claim.',
    rows: [],
    failures: [],
  };
  const directory = path.resolve(
    __dirname,
    '../../../../reports/ingestion-extended',
  );
  await mkdir(directory, { recursive: true });
  for (const fixture of corpus.fixtures) {
    for (let iteration = 0; iteration < 3; iteration++) {
      const { parser } = parserRuntime({
        DOCUMENT_PARSER: 'mineru',
        MINERU_BASE_URL: process.env.MINERU_BASE_URL || 'http://127.0.0.1:8000',
      });
      const start = performance.now();
      const parsed = await parser.parse(
        fixture.data,
        fixture.name,
        `extended-${iteration}`,
      );
      const row = {
        name: fixture.name,
        iteration,
        sha256: createHash('sha256').update(fixture.data).digest('hex'),
        bytes: fixture.data.length,
        ms: performance.now() - start,
        parser: parsed.parser,
        ready: parsed.ready,
        quality: parsed.quality,
        facts: fixture.facts.length,
        covered: fixture.facts.filter((fact) => parsed.markdown.includes(fact))
          .length,
        forbidden: (fixture.forbidden || []).filter((text) =>
          parsed.markdown.includes(text),
        ),
        sourceLocations: parsed.sections?.map((section) => section.source),
        provenance: parsed.provenance,
      };
      report.rows.push(row);
      try {
        assert.equal(
          row.ready,
          !fixture.invalid && !fixture.review,
          fixture.name,
        );
        assert.equal(row.covered, row.facts, `${fixture.name}: facts`);
        assert.deepEqual(row.forbidden, []);
        if (!fixture.invalid) assert.equal(row.parser, 'mineru');
        if (fixture.review)
          assert.ok(
            row.quality.issues.some(
              (issue) => issue.code === 'HTML_IMAGE_NOT_IMPORTED',
            ),
          );
        if (fixture.name === 'slides.ppt')
          assert.ok(row.sourceLocations.some((source) => source.slide === 2));
      } catch (error) {
        report.failures.push({
          name: fixture.name,
          iteration,
          message: error.message,
        });
      }
      // Keep a usable failure report even if a later input fails or a process is interrupted.
      await writeFile(
        path.join(directory, 'verification.json'),
        JSON.stringify(report, null, 2) + '\n',
      );
    }
  }
  console.table(
    report.rows.map(({ name, iteration, ready, facts, covered, ms }) => ({
      name,
      iteration,
      ready,
      facts,
      covered,
      ms: ms.toFixed(2),
    })),
  );
  if (report.failures.length) {
    console.error(report.failures);
    process.exitCode = 1;
  }
}
run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
