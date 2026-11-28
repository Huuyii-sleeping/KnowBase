const { baselineReference } = require('../baseline-reference.cjs');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { execFileSync } = require('node:child_process');
const { readFile, writeFile } = require('node:fs/promises');
const ts = require('typescript');
const { root, fingerprint, gitState } = require('./trace.cjs');
const { loadCorpus, digest } = require('./corpus.cjs');
const { readCase, validateDeliveryRun } = require('./delivery-artifacts.cjs');
const { tableBodyAudit } = require('./table-body-audit.cjs');
const { tableScore } = require('../quality/metrics.cjs');
const {
  markdownBlocks,
} = require('../../../dist/src/modules/ingestion/markdown-blocks.js');
const {
  PdfTableNormalizer,
} = require('../../../dist/src/modules/documents/parsing/pdf/pdf-table-normalizer.js');
const normalizerPath =
  'apps/api/src/modules/documents/parsing/pdf/pdf-table-normalizer.ts';

function baselineNormalizer(ref) {
  // Resolve a commit before git show; never check out or mutate workspace files.
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  const revision = git(
    'rev-parse',
    '--verify',
    '--end-of-options',
    `${baselineReference(ref)}^{commit}`,
  ).trim();
  const source = git('show', `${revision}:${normalizerPath}`);
  const filename = path.join(
    root,
    'apps/api/dist/src/modules/documents/parsing/pdf/baseline.js',
  );
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded._compile(
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2023,
      },
    }).outputText,
    filename,
  );
  return {
    revision,
    sourceSha256: digest(source),
    Normalizer: loaded.exports.PdfTableNormalizer,
  };
}

function replay(structure, references, Normalizer) {
  const normalizer = new Normalizer();
  const blocks = [];
  const issues = [];
  for (const page of structure.pages) {
    const tables = page.blocks.filter((block) => block.type === 'table');
    for (const table of tables) {
      const result = normalizer.normalize(
        table.content,
        table.captions || [],
        page.page_idx + 1,
        tables.length,
      );
      blocks.push(
        ...markdownBlocks(result.content, [
          {
            start: 0,
            end: result.content.length,
            source: { page: page.page_idx + 1 },
          },
        ]),
      );
      issues.push(...result.issues.map((issue) => issue.code));
    }
  }
  return {
    body: tableBodyAudit({ blocks }, references),
    full: references.map((ref) =>
      tableScore(
        blocks
          .filter((x) => x.table && x.source?.page === ref.page)
          .map((x) => x.table),
        [ref],
      ),
    ),
    issues,
  };
}

async function compare(corpusDir, runDir, ref, output) {
  const corpus = await loadCorpus(corpusDir);
  const runBytes = await readFile(path.join(runDir, 'run.json'));
  const run = JSON.parse(runBytes);
  validateDeliveryRun(run, corpus);
  const baseline = baselineNormalizer(ref);
  // The comparison isolates normalization; shared table parsing must be unchanged.
  execFileSync(
    'git',
    [
      'diff',
      '--exit-code',
      baseline.revision,
      '--',
      'apps/api/src/modules/ingestion/tables',
      'apps/api/src/modules/ingestion/markdown-blocks.ts',
    ],
    { cwd: root },
  );
  const report = {
    schema: 'ocr-table-replay-v1',
    createdAt: new Date().toISOString(),
    git: gitState(),
    baseline: {
      revision: baseline.revision,
      sourceSha256: baseline.sourceSha256,
    },
    source: await fingerprint(
      path.join(root, 'apps/api/src/modules/documents/parsing/pdf'),
    ),
    compiled: await fingerprint(
      path.join(root, 'apps/api/dist/src/modules/documents/parsing/pdf'),
    ),
    tool: await fingerprint(__dirname),
    runSha256: digest(runBytes),
    manifestSha256: corpus.manifestSha256,
    scope:
      'Identical saved real MinerU structured table bytes through actual Git baseline and current normalizers, then shared unchanged table parser and metrics. No inference or publication.',
    cases: [],
  };
  for (const row of run.cases.filter((x) => x.category === 'scanned-table')) {
    assert.equal(row.status, 'completed');
    const { result, assets, parsedSha256 } = await readCase(runDir, row);
    const raw = assets
      .filter((x) => x.mime === 'application/json')
      .map((x) => JSON.parse(x.data))
      .find((x) => x.structuredContent);
    assert.ok(raw?.structuredContent, 'Missing real structured OCR payload');
    const references = corpus.gold.get(row.id).tables;
    const after = replay(raw.structuredContent, references, PdfTableNormalizer);
    assert.deepEqual(after.body, tableBodyAudit(result, references));
    report.cases.push({
      id: row.id,
      inputSha256: row.inputSha256,
      parsedSha256,
      structuredSha256: digest(JSON.stringify(raw.structuredContent)),
      before: replay(raw.structuredContent, references, baseline.Normalizer),
      after,
    });
  }
  assert.ok(report.cases.length, 'No scanned tables to compare');
  await writeFile(output, JSON.stringify(report, null, 2) + '\n', {
    flag: 'wx',
  });
  return report;
}
if (require.main === module) {
  if (process.argv.length !== 6)
    throw new Error(
      'Usage: replay-ocr-tables.cjs CORPUS RUN BASELINE_COMMIT NEW_REPORT',
    );
  compare(...process.argv.slice(2))
    .then((report) =>
      console.log(`Compared ${report.cases.length} identical OCR observations`),
    )
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
module.exports = { baselineNormalizer, replay, compare };
