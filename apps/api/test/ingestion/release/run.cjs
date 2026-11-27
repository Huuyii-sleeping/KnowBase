const assert = require('node:assert/strict');
const path = require('node:path');
const { mkdir, writeFile, readFile } = require('node:fs/promises');
const { execFileSync } = require('node:child_process');
const { ReleaseEnvironment } = require('./environment.cjs');
const { compileSnapshot } = require('./snapshot.cjs');
const { pgMigrations, mongoMigrations } = require('./migrations.cjs');
const { root, gitState, fingerprint } = require('../complex-quality/trace.cjs');
const { runtimeIdentity } = require('../acceptance/runtime.cjs');
async function run() {
  const output = path.resolve(
    process.env.RELEASE_OUTPUT || 'reports/ingestion-release/fixed-pair',
  );
  await mkdir(path.dirname(output), { recursive: true });
  await mkdir(output, { recursive: false });
  const runtime = await runtimeIdentity();
  if (!process.env.RELEASE_MINERU_SNAPSHOT)
    throw Error('Missing RELEASE_MINERU_SNAPSHOT');
  const mineruSnapshot = JSON.parse(
    await readFile(process.env.RELEASE_MINERU_SNAPSHOT, 'utf8'),
  );
  assert.equal(mineruSnapshot.schema, 'mineru-runtime-snapshot-v1');
  assert.equal(runtime.mineru, 'mineru-4.2.3:' + mineruSnapshot.sha256);
  assert.equal(
    mineruSnapshot.packages.find((p) => p.name.toLowerCase() === 'mineru')
      ?.version,
    '4.2.3',
  );
  const report = {
    schema: 'ingestion-release-v1',
    createdAt: new Date().toISOString(),
    git: gitState(),
    runtime,
    mineruSnapshot,
    lockfileSha256: require('./workflow.cjs').sha(
      await readFile(path.join(root, 'pnpm-lock.yaml')),
    ),
    source: await fingerprint(path.join(root, 'apps/api/src')),
    compiled: await fingerprint(path.join(root, 'apps/api/dist/src')),
    tools: await fingerprint(__dirname),
    deploy: await fingerprint(path.join(root, 'deploy')),
    scope:
      'Isolated fixed branch pair, real MinerU/Ollama and six storage/queue services; current lockfile for both binaries. Not latest main integration or production deployment.',
    cases: [],
    status: 'running',
  };
  const save = () =>
    writeFile(
      path.join(output, 'report.json'),
      JSON.stringify(report, null, 2) + '\n',
    );
  const env = new ReleaseEnvironment();
  env.events = [];
  const docs = [];
  const scenario = async (name, work) => {
    const item = { name, status: 'running' };
    report.cases.push(item);
    await save();
    try {
      item.evidence = await work();
      item.status = 'passed';
      console.log('PASS ' + name);
    } catch (error) {
      item.status = 'failed';
      item.error = error.message;
      throw error;
    } finally {
      await save();
    }
  };
  try {
    const oldRef = execFileSync(
      'git',
      ['rev-parse', 'd825b0f365291e48cc747f85bd51bd25f91f07c8^{commit}'],
      {
        cwd: root,
        encoding: 'utf8',
      },
    ).trim();
    report.rollbackArtifact = await compileSnapshot(
      oldRef,
      path.join(output, 'rollback-code'),
    );
    const oldEntry = report.rollbackArtifact.entrypoint;
    const currentEntry = path.join(root, 'apps/api/dist/src/main.js');
    env.applicationEntrypoint = oldEntry;
    await env.start(output);
    report.images = JSON.parse(await env.compose('images', '--format', 'json'));
    report.configuration = {
      parser: 'mineru',
      imageMode: 'ocr',
      async: true,
      productionEntrypoints: true,
      upgradedChunkSize: 256,
      rollbackChunkSize: 1000,
      overlap: 20,
      embeddingDimensions: 768,
      sameEmbeddingSpace: true,
      outboxPollMs: 100,
      outboxBatch: 10,
      generationGcEnabled: false,
      mutationIngress: 'isolated harness is the only writer',
    };

    await scenario(
      'legacy PostgreSQL schema upgrade and repeat migration',
      () => pgMigrations(env),
    );
    await scenario('MongoDB index upgrade preserves data and uniqueness', () =>
      mongoMigrations(env),
    );
    const context = { env, docs, scenario, oldEntry, currentEntry, report };
    const draft = await require('./upgrade-cases.cjs')(context);
    await require('./policy-cases.cjs')(context);
    await require('./rollback-cases.cjs')({ ...context, draft });
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.error = error.message;
    throw error;
  } finally {
    try {
      await env.close();
      report.isolatedServicesRemoved = true;
    } finally {
      await save();
    }
  }
}
run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
