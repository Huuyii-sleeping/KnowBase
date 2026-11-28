const path = require('node:path');
const { mkdir, writeFile } = require('node:fs/promises');
const { AcceptanceEnvironment, root } = require('./environment.cjs');
const { httpClient } = require('./http.cjs');
const { runScenario } = require('./scenario.cjs');
const { fingerprint, gitState } = require('../complex-quality/trace.cjs');
async function run(output) {
  const runtime = await require('./runtime.cjs').runtimeIdentity();
  await mkdir(output, { recursive: false });
  const env = new AcceptanceEnvironment();
  const report = {
    schema: 'ingestion-http-acceptance-v1',
    createdAt: new Date().toISOString(),
    git: gitState(),
    source: await fingerprint(path.join(root, 'apps/api/src')),
    tools: await fingerprint(__dirname),
    frontend: await fingerprint(path.join(root, 'apps/web/src')),
    compiled: await fingerprint(path.join(root, 'apps/api/dist/src')),
    runtime,
    mineru: process.env.QUALITY_MINERU_REVISION,
    embedding: process.env.QUALITY_EMBEDDING_REVISION,
    kg: process.env.QUALITY_KG_REVISION,
    status: 'running',
    cases: [],
    events: [],
  };
  const flush = () =>
    writeFile(
      path.join(output, 'report.json'),
      JSON.stringify(report, null, 2) + '\n',
    );
  try {
    await env.start(output);
    const login = httpClient(env.baseUrl, null, report.events),
      actors = {};
    for (const role of ['admin', 'owner', 'reader', 'outsider']) {
      const auth = await login(
        'POST',
        '/auth/login',
        { username: 'acceptance-' + role, password: env.password },
        201,
      );
      actors[role] = httpClient(env.baseUrl, auth.accessToken, report.events);
    }
    const fixtures = await require('./fixtures.cjs').acceptanceFixtures();
    report.images = JSON.parse(await env.compose('images', '--format', 'json'));
    report.configuration = {
      parser: 'mineru',
      imageMode: 'ocr',
      async: true,
      workers: true,
      chunkSize: 1000,
      chunkOverlap: 150,
      embeddingDimensions: 768,
      objectStorage: 'RustFS',
      scope:
        'isolated HTTP and Worker lifecycle; no relevance or graph fact accuracy measurement',
    };
    report.converterVersion = fixtures.converterVersion;
    const selected = process.env.ACCEPTANCE_CASE_IDS
      ? new Set(process.env.ACCEPTANCE_CASE_IDS.split(',').filter(Boolean))
      : null;
    if (
      selected &&
      [...selected].some((id) => !fixtures.cases.some((item) => item.id === id))
    )
      throw new Error('Unknown acceptance case selection');
    for (const fixture of fixtures.cases.filter(
      (item) => !selected || selected.has(item.id),
    )) {
      const entry = { id: fixture.id, status: 'running' };
      report.cases.push(entry);
      await flush();
      try {
        Object.assign(
          entry,
          await runScenario(env, actors, fixture, report.events),
        );
      } catch (error) {
        entry.status = 'failed';
        entry.error = error.message;
        throw error;
      }
      await flush();
    }
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.error = error.message;
    await flush();
    throw error;
  } finally {
    try {
      await env.close();
      report.isolatedServicesRemoved = true;
    } finally {
      await flush();
    }
  }
}
if (require.main === module)
  run(path.resolve(process.argv[2])).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
module.exports = { run };
