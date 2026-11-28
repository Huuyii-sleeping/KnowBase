const os = require('node:os');
const path = require('node:path');
const { mkdir, writeFile } = require('node:fs/promises');
const { execFileSync } = require('node:child_process');
const { PerformanceEnvironment } = require('./performance/environment.cjs');
const {
  observeEmbeddings,
  benchmarkEmbeddings,
} = require('./performance/embedding.cjs');
const { benchmarkChunks } = require('./performance/chunks.cjs');
const { benchmarkIndex } = require('./performance/index.cjs');
const { legacyRuntime } = require('./legacy-runtime.cjs');

async function run() {
  const endpoint = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
  const model = process.env.OLLAMA_EMBEDDING_MODEL || 'nomic-embed-text:latest';
  const response = await fetch(`${endpoint}/api/tags`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error('Ollama model inventory unavailable');
  const selected = (await response.json()).models.find(
    (entry) => entry.name === model,
  );
  if (!selected?.digest)
    throw new Error(`Installed immutable model digest not found: ${model}`);
  const config = {
    EMBEDDING_PROVIDER: 'ollama',
    OLLAMA_BASE_URL: endpoint,
    OLLAMA_EMBEDDING_MODEL: model,
    EMBEDDING_MODEL_REVISION: selected.digest,
    RAG_EMBEDDING_DIMENSIONS: 768,
    RAG_EMBEDDING_BATCH_SIZE: 32,
    RAG_EMBEDDING_CONCURRENCY: 2,
  };
  const observer = observeEmbeddings(endpoint);
  const env = new PerformanceEnvironment();
  let old;
  try {
    old = legacyRuntime(process.argv[2] || '955f1e1', config);
    await env.start();
    const report = {
      createdAt: new Date().toISOString(),
      node: process.version,
      cpu: os.cpus()[0]?.model,
      platform: os.platform(),
      arch: os.arch(),
      baselineRevision: old.revision,
      currentRevision: execFileSync('git', ['rev-parse', 'HEAD'], {
        encoding: 'utf8',
      }).trim(),
      workingTreeDirty: Boolean(
        execFileSync('git', ['status', '--porcelain'], {
          encoding: 'utf8',
        }).trim(),
      ),
      versions: env.versions,
      model,
      modelDigest: selected.digest,
      repeats: 3,
      embeddingLimits: {
        batchSize: 32,
        concurrency: 2,
        batchCharacters: 24000,
      },
      chunks: await benchmarkChunks(env, 3),
      embeddings: await benchmarkEmbeddings(env, old, config, observer, 3),
      index: await benchmarkIndex(env, old, 3),
    };
    const directory = path.resolve(
      __dirname,
      '../../../../reports/ingestion-performance',
    );
    await mkdir(directory, { recursive: true });
    const target = path.join(directory, 'comparison.json');
    await writeFile(target, JSON.stringify(report, null, 2) + '\n');
    console.log('Report:', target);
    console.table(
      report.embeddings.rows.map((row) => ({
        scenario: row.scenario,
        iteration: row.iteration,
        beforeInputs: row.before.inputs,
        afterInputs: row.after.inputs,
        beforeMs: row.before.ms.toFixed(2),
        afterMs: row.after.ms.toFixed(2),
      })),
    );
    console.table(
      report.chunks.rows.map((row) => ({
        iteration: row.iteration,
        chunks: row.chunks,
        beforeMs: row.before.ms.toFixed(2),
        afterMs: row.after.ms.toFixed(2),
        hitMs: row.after.hitMs.toFixed(2),
      })),
    );
    console.table(report.index.rows);
  } finally {
    observer.restore();
    old?.dispose();
    await env.close();
  }
}
run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
