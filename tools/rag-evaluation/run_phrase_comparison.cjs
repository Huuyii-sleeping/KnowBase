const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { options } = require('./benchmark-options.cjs');
const {
  collectMetadata,
  snapshotIndexedCorpus,
} = require('./benchmark-metadata.cjs');
const {
  RetrievalBenchmarkEnvironment,
} = require('./benchmark-environment.cjs');
const { BenchmarkApiClient, seedCorpus } = require('./benchmark-corpus.cjs');
const { runPairedRecall } = require('./paired-recall.cjs');
const root = path.resolve(__dirname, '../..');
const DATASETS = ['knowbase-recall-v3', 'knowbase-phrase-v1'];
const FIXED = {
  encoding: 'plain',
  lexical: 'cjk',
  context: 'title-heading',
  keywordPolicy: 'body-reserve',
  bodySlots: 2,
  queryMode: 'off',
  keywordQueryMode: 'off',
};

async function evaluate(executable, dataset, output) {
  const { stdout } = await promisify(execFile)(
    executable,
    [
      path.join(__dirname, 'recall_audit.py'),
      '--dataset',
      dataset,
      '--output-dir',
      output,
    ],
    { cwd: root },
  );
  console.log(stdout.trim());
}

async function runDataset(config, name, output) {
  const directory = path.join(root, 'benchmarks', name);
  await promisify(execFile)(config.python, [
    path.join(__dirname, 'benchmark_dataset.py'),
    directory,
  ]);
  await fs.mkdir(output);
  const status = (value) =>
    fs.writeFile(
      path.join(output, 'run-status.json'),
      JSON.stringify(value) + '\n',
    );
  await status({ status: 'running' });
  const environment = new RetrievalBenchmarkEnvironment();
  try {
    await environment.start();
    const ollamaUrl =
      process.env.KNOWBASE_BENCHMARK_OLLAMA_URL || 'http://127.0.0.1:11434';
    await environment.launchApi(
      output,
      ollamaUrl,
      FIXED.encoding,
      FIXED.lexical,
      FIXED.context,
      FIXED.keywordPolicy,
      FIXED.bodySlots,
    );
    const client = new BenchmarkApiClient(environment.baseUrl);
    await client.login();
    const manifest = JSON.parse(
      await fs.readFile(path.join(directory, 'manifest.json'), 'utf8'),
    );
    const documents = await seedCorpus(
      client,
      environment.source,
      directory,
      manifest,
    );
    console.log(`Paired corpus ready: ${name}, ${documents.length} documents`);
    const metadata = await collectMetadata({
      directory,
      manifest,
      documents,
      environment,
      ollamaUrl,
      config: FIXED,
    });
    await fs.writeFile(
      path.join(output, 'metadata.json'),
      JSON.stringify(metadata, null, 2) + '\n',
    );
    await snapshotIndexedCorpus(environment, output);
    const questions = JSON.parse(
      await fs.readFile(path.join(directory, 'questions.json'), 'utf8'),
    );
    const groups = await runPairedRecall(
      environment.api,
      client,
      questions,
      output,
    );
    for (const group of groups) {
      await fs.copyFile(
        path.join(output, 'indexed-corpus.json'),
        path.join(group.directory, 'indexed-corpus.json'),
      );
      await fs.writeFile(
        path.join(group.directory, 'metadata.json'),
        JSON.stringify(
          {
            ...metadata,
            keyword_match_mode: group.mode,
            recall_audit: {
              budgets: ['k30-s15'],
              route_budgets: [{ id: 'k30-s15', keyword: 30, semantic: 15 }],
              split: 'all',
              requests: questions.length,
              query_mode: 'off',
              keyword_query_mode: 'off',
              keyword_match_mode: group.mode,
              repetition: group.repeat,
              paired_same_index: true,
              http_parity_scope:
                'Original query only, production15:15; experimental path remains internal',
            },
          },
          null,
          2,
        ) + '\n',
      );
      await evaluate(config.python, directory, group.directory);
      await fs.writeFile(
        path.join(group.directory, 'run-status.json'),
        JSON.stringify({ status: 'completed' }) + '\n',
      );
    }
  } catch (error) {
    await status({ status: 'failed', error: error.message });
    try {
      await fs.writeFile(
        path.join(output, 'infrastructure.log'),
        await environment.compose('logs', '--no-color', '--tail', '40'),
      );
    } catch {}
    throw error;
  } finally {
    try {
      await environment.close();
    } catch (error) {
      await status({
        status: 'failed',
        phase: 'cleanup',
        error: error.message,
      });
      throw error;
    }
    console.log(`Cleaned paired benchmark: ${name}`);
  }
  await status({ status: 'completed' });
}

async function main(args) {
  if (
    args.some(
      (v, i) => i % 2 === 0 && !['--python', '--output-dir'].includes(v),
    )
  )
    throw new Error('Phrase comparison accepts only --python and --output-dir');
  const config = options([
    '--output-dir',
    'reports/retrieval-phrase-paired',
    ...args,
  ]);
  const output = path.join(
    config.output,
    `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`,
  );
  await fs.mkdir(output, { recursive: true });
  for (const name of DATASETS)
    await runDataset(config, name, path.join(output, name));
  console.log(`Phrase paired comparison: ${output}`);
}

if (require.main === module)
  main(process.argv.slice(2)).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
module.exports = { main, runDataset };
