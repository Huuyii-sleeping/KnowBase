const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { mkdir, writeFile, readFile } = require('node:fs/promises');
const { performance } = require('node:perf_hooks');
const { CapacityEnvironment } = require('./environment.cjs');
const { CapacityMonitor } = require('./monitor.cjs');
const { ingest, drain, cleanup } = require('./workload.cjs');
const { boundedMap, distribution, stageMetrics } = require('./metrics.cjs');
const { root, gitState, fingerprint } = require('../complex-quality/trace.cjs');
async function run() {
  const output = path.resolve(
    process.env.CAPACITY_OUTPUT || 'reports/ingestion-capacity/fixed-load',
  );
  await mkdir(path.dirname(output), { recursive: true });
  await mkdir(output, { recursive: false });
  const env = new CapacityEnvironment();
  env.events = [];
  const report = {
    schema: 'ingestion-capacity-v1',
    createdAt: new Date().toISOString(),
    git: gitState(),
    source: await fingerprint(path.join(root, 'apps/api/src')),
    compiled: await fingerprint(path.join(root, 'apps/api/dist/src')),
    tools: await fingerprint(__dirname),
    compose: await fingerprint(path.join(root, 'deploy')),
    scope:
      'Synthetic ASCII TXT, native parser, deterministic 768d embeddings and empty graph extraction. Real HTTP/workers/PG/Mongo/RabbitMQ/RustFS/ES/Neo4j. Excludes OCR, actual model cost, real business corpus, dedicated-host SLA and maximum capacity.',
    configuration: {
      concurrency: [1, 4, 8],
      filesPerProfile: 20,
      bytes: [16384, 65536],
      pages: 'not applicable (TXT)',
      warmupFiles: 2,
      prefetchPerConsumer: 1,
      parseConsumer: 1,
      outboxPollMs: 1000,
      outboxBatch: 20,
      chunkCharacters: 1000,
      chunkOverlap: 150,
      apiHeapLimitMiB: 512,
      monitorIntervalMs: 500,
      quantiles:
        'empirical nearest rank, per-profile n=20; exploratory, not SLA',
      arrival:
        'closed loop; a slot includes upload, parse polling, publish, activation polling and readback; deletion outside timed profile',
      cache:
        'new document IDs every profile; no cross-document embedding cache; deterministic unique ordinal text, no model latency',
    },
    host: {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      logicalCpus: os.cpus().length,
      memoryBytes: os.totalmem(),
    },
    profiles: [],
    status: 'running',
  };
  const save = () =>
    writeFile(
      path.join(output, 'report.json'),
      JSON.stringify(report, null, 2) + '\n',
    );
  try {
    await env.start(output);
    const port = Number(
      (await env.compose('port', 'rabbitmq', '15672')).split(':').pop(),
    );
    const management = `http://127.0.0.1:${port}`;
    const docker = (...args) =>
      execFileSync('docker', args, { encoding: 'utf8' });
    report.dockerHost = JSON.parse(docker('info', '--format', '{{json .}}'));
    report.dockerHost = Object.fromEntries(
      [
        'Architecture',
        'NCPU',
        'MemTotal',
        'ServerVersion',
        'OperatingSystem',
      ].map((key) => [key, report.dockerHost[key]]),
    );
    const ids = (await env.compose('ps', '-q')).split('\n').filter(Boolean);
    report.services = JSON.parse(docker('inspect', ...ids)).map((c) => ({
      service: c.Config.Labels['com.docker.compose.service'],
      image: c.Config.Image,
      imageId: c.Image,
      cpus: c.HostConfig.NanoCpus / 1e9,
      memoryBytes: c.HostConfig.Memory,
    }));
    const actors = {
      owner: await env.login('owner'),
      admin: await env.login('admin'),
    };
    let ordinal = 0;
    const warm = [];
    try {
      for (let i = 0; i < 2; i++)
        await ingest(env, actors, 16384, ordinal++, warm);
      await drain(env);
    } finally {
      await cleanup(env, actors.owner, warm);
    }
    for (const bytes of report.configuration.bytes) {
      for (const concurrency of report.configuration.concurrency) {
        const entry = { bytes, concurrency, files: [], status: 'running' };
        report.profiles.push(entry);
        const created = [];
        const monitor = new CapacityMonitor(env, management);
        try {
          await monitor.start();
          const start = performance.now();
          entry.files = await boundedMap(
            Array.from({ length: 20 }),
            concurrency,
            () => ingest(env, actors, bytes, ordinal++, created),
          );
          entry.wallMs = performance.now() - start;
          const drainStart = performance.now();
          await drain(env);
          entry.drainMs = performance.now() - drainStart;
          entry.docsPerSecond = (entry.files.length * 1000) / entry.wallMs;
          entry.inputMiBPerSecond =
            (bytes * entry.files.length * 1000) / entry.wallMs / 1048576;
          entry.latencyMs = Object.fromEntries(
            [
              'uploadMs',
              'parseReadyMs',
              'publishMs',
              'indexActiveMs',
              'endToEndMs',
              'verifiedMs',
            ].map((key) => [key, distribution(entry.files.map((f) => f[key]))]),
          );
          entry.status = 'passed';
        } catch (error) {
          entry.status = 'failed';
          entry.error = error.message;
          throw error;
        } finally {
          entry.resources = await monitor.stop();
          entry.stagesMs = stageMetrics(
            await readFile(path.join(output, 'api.log'), 'utf8'),
            new Set(created.map((d) => d.id)),
          );
          await cleanup(env, actors.owner, created);
          entry.cleanup = true;
          await save();
        }
        assert.equal(entry.resources.errors.length, 0, 'Incomplete telemetry');
        console.log(
          JSON.stringify({
            bytes,
            concurrency,
            docsPerSecond: entry.docsPerSecond,
            p95Ms: entry.latencyMs.endToEndMs.p95,
            rssMiB: entry.resources.rssBytes.max / 1048576,
            ready: entry.resources.rabbitReady.max,
            unacked: entry.resources.rabbitUnacked.max,
          }),
        );
      }
    }
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
