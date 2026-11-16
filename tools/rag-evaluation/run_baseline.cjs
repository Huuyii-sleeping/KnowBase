const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const {
  RetrievalBenchmarkEnvironment,
} = require('./benchmark-environment.cjs');
const { BenchmarkApiClient, seedCorpus } = require('./benchmark-corpus.cjs');
const root = path.resolve(__dirname, '../..');

function options(args) {
  const result = {
    python: process.env.KNOWBASE_EVAL_PYTHON || 'python3',
    output: path.join(root, 'reports/retrieval-knowbase-v1'),
  };
  for (let i = 0; i < args.length; i += 2) {
    if (!['--python', '--output-dir'].includes(args[i]) || !args[i + 1])
      throw new Error(
        'Usage: run_baseline.cjs [--python executable] [--output-dir directory]',
      );
    if (args[i] === '--python') result.python = args[i + 1];
    else result.output = path.resolve(root, args[i + 1]);
  }
  return result;
}

async function python(executable, args, environment = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: root,
      env: { ...process.env, ...environment },
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`Python evaluation exited with status ${code}`)),
    );
  });
}

async function main(args) {
  const config = options(args);
  const directory = path.join(root, 'benchmarks/knowbase-retrieval-v1');
  await python(config.python, [
    path.join(__dirname, 'benchmark_dataset.py'),
    directory,
  ]);
  await fs.mkdir(config.output, { recursive: true });
  const output = path.join(
    config.output,
    `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`,
  );
  await fs.mkdir(output);
  const statusPath = path.join(output, 'run-status.json');
  await fs.writeFile(statusPath, JSON.stringify({ status: 'running' }) + '\n');
  const manifest = JSON.parse(
    await fs.readFile(path.join(directory, 'manifest.json'), 'utf8'),
  );
  const environment = new RetrievalBenchmarkEnvironment();
  try {
    console.log('Starting isolated retrieval benchmark services');
    await environment.start();
    const ollamaUrl =
      process.env.KNOWBASE_BENCHMARK_OLLAMA_URL || 'http://127.0.0.1:11434';
    await environment.launchApi(output, ollamaUrl);
    const client = new BenchmarkApiClient(environment.baseUrl);
    await client.login();
    const documents = await seedCorpus(
      client,
      environment.source,
      directory,
      manifest,
    );
    console.log(
      `Published and indexed ${documents.length} benchmark documents`,
    );
    const files = [
      'manifest.json',
      'questions.json',
      ...manifest.documents.map((item) => `docs/${item.file}`),
    ];
    const hashes = {};
    for (const file of files)
      hashes[file] = createHash('sha256')
        .update(await fs.readFile(path.join(directory, file)))
        .digest('hex');
    const { stdout: commit } = await promisify(execFile)(
      'git',
      ['rev-parse', 'HEAD'],
      { cwd: root },
    );
    const { stdout: status } = await promisify(execFile)(
      'git',
      ['status', '--porcelain'],
      { cwd: root },
    );
    const modelResponse = await fetch(`${ollamaUrl}/api/tags`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!modelResponse.ok)
      throw new Error('Cannot inspect local embedding model metadata');
    const model = (await modelResponse.json()).models.find((item) =>
      ['nomic-embed-text', 'nomic-embed-text:latest'].includes(item.name),
    );
    if (!model)
      throw new Error(
        'nomic-embed-text must be installed in the selected Ollama server',
      );
    const chunkResponse = await fetch(
      `${environment.elasticsearchUrl}/kh_chunk/_count`,
      { signal: AbortSignal.timeout(10000) },
    );
    if (!chunkResponse.ok)
      throw new Error('Cannot inspect indexed benchmark chunk count');
    const chunkCount = (await chunkResponse.json()).count;
    const metadata = {
      dataset: manifest.version,
      started_at: new Date().toISOString(),
      api_git_commit: commit.trim(),
      working_tree_dirty: Boolean(status.trim()),
      document_count: documents.length,
      indexed_chunk_count: chunkCount,
      question_count: JSON.parse(
        await fs.readFile(path.join(directory, 'questions.json'), 'utf8'),
      ).length,
      corpus_sha256: hashes,
      embedding_model: model.name,
      embedding_digest: model?.digest || null,
      dimensions: 768,
      chunk_size: 1000,
      chunk_overlap: 150,
      reranking: 'existing rule-based implementation; unchanged',
      scope:
        'Isolated corpus; real HTTP API, auth, parsing, persistence, RabbitMQ, Elasticsearch and Ollama embeddings; only search and RAG workers; no graph or answer evaluation.',
      top_k: [1, 3, 5],
      modes: ['keyword', 'semantic', 'hybrid'],
      warmup:
        'One untimed request per mode after corpus indexing; one measured pass per mode/K.',
      ranking_unit:
        'Deduplicate the first API TopK candidates by document; no extra candidate fetch. Evidence checks inspect all returned TopK contents.',
    };
    const metadataPath = path.join(output, 'metadata.json');
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2) + '\n');
    await python(
      config.python,
      [
        path.join(__dirname, 'run_matrix.py'),
        '--base-url',
        environment.baseUrl,
        '--dataset',
        directory,
        '--output-dir',
        output,
        '--metadata',
        metadataPath,
      ],
      { KNOWBASE_TOKEN: client.token },
    );
    console.log(`Benchmark comparison: ${path.join(output, 'comparison.md')}`);
  } catch (error) {
    await fs.writeFile(
      statusPath,
      JSON.stringify({ status: 'failed', error: error.message }) + '\n',
    );
    throw error;
  } finally {
    try {
      await environment.close();
      console.log('Removed isolated benchmark containers and volumes');
    } catch (error) {
      await fs.writeFile(
        statusPath,
        JSON.stringify({
          status: 'failed',
          phase: 'cleanup',
          error: error.message,
        }) + '\n',
      );
      throw error;
    }
  }
  await fs.writeFile(
    statusPath,
    JSON.stringify({ status: 'completed' }) + '\n',
  );
}

if (require.main === module)
  main(process.argv.slice(2)).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
module.exports = { options, main };
