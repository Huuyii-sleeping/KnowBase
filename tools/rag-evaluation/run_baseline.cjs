const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { options } = require('./benchmark-options.cjs');
const {
  collectMetadata,
  snapshotIndexedCorpus,
} = require('./benchmark-metadata.cjs');
const {
  RetrievalBenchmarkEnvironment,
} = require('./benchmark-environment.cjs');
const { BenchmarkApiClient, seedCorpus } = require('./benchmark-corpus.cjs');
const root = path.resolve(__dirname, '../..');

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
  const directory = config.dataset;
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
    await environment.launchApi(
      output,
      ollamaUrl,
      config.encoding,
      config.lexical,
      config.context,
      config.keywordPolicy,
    );
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
    const metadata = await collectMetadata({
      directory,
      manifest,
      documents,
      environment,
      ollamaUrl,
      config,
    });
    const metadataPath = path.join(output, 'metadata.json');
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2) + '\n');
    if (config.suite === 'recall') {
      await snapshotIndexedCorpus(environment, output);
      const { runRecallAudit } = require('./run_recall_audit.cjs');
      metadata.recall_audit = await runRecallAudit(
        environment,
        client,
        directory,
        output,
        {
          split: config.split,
          budgets: config.budgets,
          routeBudgets: config.routeBudgets,
        },
      );
      await fs.writeFile(
        metadataPath,
        JSON.stringify(metadata, null, 2) + '\n',
      );
      await python(config.python, [
        path.join(__dirname, 'recall_audit.py'),
        '--dataset',
        directory,
        '--output-dir',
        output,
      ]);
    } else
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
    console.log(
      `Benchmark report: ${path.join(output, config.suite === 'recall' ? 'recall-audit.md' : 'comparison.md')}`,
    );
  } catch (error) {
    // Preserve startup failures before cleanup removes the temporary containers.
    try {
      await fs.writeFile(
        path.join(output, 'infrastructure.log'),
        await environment.compose('logs', '--no-color', '--tail', '80'),
      );
    } catch {
      /* Diagnostics must not mask the original failure. */
    }
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
