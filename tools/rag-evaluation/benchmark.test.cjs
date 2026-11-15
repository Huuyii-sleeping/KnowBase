const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  RetrievalBenchmarkEnvironment,
} = require('./benchmark-environment.cjs');
const { BenchmarkApiClient, seedCorpus } = require('./benchmark-corpus.cjs');
const { options } = require('./run_baseline.cjs');

test('benchmark HTTP client sends multipart bodies unchanged, authenticates and surfaces failures', async () => {
  const calls = [];
  const client = new BenchmarkApiClient('http://test', async (url, input) => {
    calls.push({ url, input });
    return {
      status: calls.length === 3 ? 503 : 201,
      json: async () => ({ accessToken: 'fixture' }),
    };
  });
  await client.login();
  const form = new FormData();
  await client.request('/documents', {
    method: 'POST',
    body: form,
    status: 201,
  });
  assert.equal(calls[1].input.body, form);
  assert.equal(calls[1].input.headers.authorization, 'Bearer fixture');
  assert.equal(calls[1].input.headers['content-type'], undefined);
  await assert.rejects(client.request('/documents'), /503/);
});

test('corpus preparation publishes only parsed documents and waits for both current generation heads', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-corpus-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.mkdir(path.join(directory, 'docs'));
  await fs.writeFile(path.join(directory, 'docs/one.md'), '# one');
  const calls = [];
  const client = {
    request: async (route, input) => {
      calls.push({ route, input });
      return { id: 'doc', parseStatus: 'READY' };
    },
  };
  let query;
  const source = {
    query: async (...args) => {
      query = args;
      return [{ pipeline: 'search' }, { pipeline: 'rag' }];
    },
  };
  const wait = async (check) => assert.equal(await check(), true);
  const manifest = { documents: [{ file: 'one.md', title: 'One' }] };
  const documents = await seedCorpus(client, source, directory, manifest, wait);
  assert.deepEqual(documents, [{ file: 'one.md', id: 'doc' }]);
  assert.deepEqual(
    calls.map((call) => call.route),
    ['/documents', '/documents/doc/submit-review', '/documents/doc/review'],
  );
  assert.equal(calls[2].input.body.approved, true);
  assert.match(query[0], /d.version=h.version/);
  assert.deepEqual(query[1], [['doc']]);
  client.request = async () => ({ id: 'bad', parseStatus: 'FAILED' });
  await assert.rejects(
    seedCorpus(client, source, directory, manifest, wait),
    /parsing failed/,
  );
});

test('environment starts an isolated retrieval API and always tears down after shutdown', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-env-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.kill = (signal) => {
    child.signalCode = signal;
    process.nextTick(() => child.emit('exit'));
  };
  let launch;
  const environment = new RetrievalBenchmarkEnvironment(
    (_file, _args, config) => {
      launch = config;
      process.nextTick(() => child.emit('message', { port: 34567 }));
      return child;
    },
  );
  environment.databaseUrl = 'postgresql://test:test@127.0.0.1:12345/test';
  environment.brokerUrl = 'amqp://test:test@127.0.0.1:12346';
  const calls = [];
  environment.compose = async (...args) => {
    calls.push(args);
    return '127.0.0.1:30000';
  };
  await environment.launchApi(
    directory,
    'http://127.0.0.1:11434',
    'plain',
    'cjk',
    'title-heading',
    'weighted',
    3,
  );
  assert.equal(launch.env.PIPELINE_WORKERS_ENABLED, 'false');
  assert.equal(launch.env.POSTGRES_DB, 'test');
  assert.equal(launch.env.RAG_RETRIEVAL_CONTEXT, 'title-heading');
  assert.equal(launch.env.RAG_KEYWORD_POLICY, 'weighted');
  assert.equal(launch.env.RAG_KEYWORD_BODY_SLOTS, '3');
  assert.equal(launch.cwd, directory);
  assert.equal(environment.baseUrl, 'http://127.0.0.1:34567/api/v1');
  await environment.close();
  assert.deepEqual(calls.at(-1), ['down', '-v', '--remove-orphans']);
  assert.equal(child.signalCode, 'SIGTERM');
});

test('cleanup still removes containers when the API shutdown operation fails', async () => {
  const environment = new RetrievalBenchmarkEnvironment();
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.kill = () => {
    throw new Error('shutdown failed');
  };
  environment.api = child;
  const calls = [];
  environment.compose = async (...args) => calls.push(args);
  await assert.rejects(environment.close(), /shutdown failed/);
  assert.deepEqual(calls, [['down', '-v', '--remove-orphans']]);
});

test('CLI rejects unsupported options before starting external services', () => {
  assert.equal(options([]).queryMode, 'off');
  assert.throws(() => options(['--query-mode', 'bad']), /Invalid/);
  assert.throws(
    () => options(['--query-mode', 'clauses-both']),
    /require recall/,
  );
  assert.equal(
    options(['--suite', 'recall', '--query-mode', 'clauses-keyword']).queryMode,
    'clauses-keyword',
  );
  for (const slots of ['0', '4', '1.5', 'x'])
    assert.throws(() => options(['--body-slots', slots]), /Invalid/);
  assert.equal(options([]).bodySlots, 2);
  assert.equal(options(['--body-slots', '1']).bodySlots, 1);
  assert.throws(() => options(['--keyword-policy', 'unknown']), /Invalid/);
  assert.equal(options([]).keywordPolicy, 'combined');
  assert.equal(
    options(['--keyword-policy', 'weighted']).keywordPolicy,
    'weighted',
  );
  assert.equal(
    options(['--keyword-policy', 'body-reserve']).keywordPolicy,
    'body-reserve',
  );
  assert.throws(() => options(['--context', 'unknown']), /Invalid/);
  assert.equal(options([]).context, 'body');
  assert.equal(options(['--context', 'title']).context, 'title');
  assert.equal(
    options(['--context', 'title-heading']).context,
    'title-heading',
  );
  assert.throws(() => options(['--unknown', 'value']), /Usage/);
  assert.throws(() => options(['--python']), /Usage/);
  assert.equal(
    options(['--python', '/fixture/python']).python,
    '/fixture/python',
  );
});
