const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { runRecallAudit } = require('./run_recall_audit.cjs');
const { options } = require('./benchmark-options.cjs');
const {
  hashDataset,
  snapshotIndexedCorpus,
} = require('./benchmark-metadata.cjs');

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-recall-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.writeFile(
    path.join(directory, 'questions.json'),
    JSON.stringify([
      { id: 'dev', question: 'development', split: 'development' },
      { id: 'val', question: 'validation', split: 'validation' },
    ]),
  );
  return directory;
}

test('recall runner keeps the selected split, actual budgets and HTTP order, without credentials in traces', async (t) => {
  const directory = await fixture(t);
  const inputs = [];
  const request = async (_child, input) => {
    inputs.push(input);
    return { selected: [{ chunkId: 'one' }], pool: [] };
  };
  const client = {
    user: { id: 'test', role: 'ADMIN' },
    token: 'secret-fixture',
    request: async () => ({ items: [{ chunkId: 'one' }] }),
  };
  const result = await runRecallAudit(
    {},
    client,
    directory,
    directory,
    { split: 'development', budgets: [5, 10] },
    request,
  );
  assert.deepEqual(
    inputs.map((i) => [i.query, i.budget]),
    [
      ['development', 15],
      ['development', 5],
      ['development', 10],
      ['development', 15],
    ],
  );
  assert.equal(result.requests, 2);
  const saved = await fs.readFile(
    path.join(directory, 'recall-traces.json'),
    'utf8',
  );
  assert.equal(saved.includes(client.token), false);
  assert.deepEqual(
    JSON.parse(saved).map((r) => r.budget),
    [5, 10],
  );
});

test('recall runner rejects HTTP mismatches and retains completed earlier budgets on later failure', async (t) => {
  const directory = await fixture(t);
  const request = async (_child, input) => {
    if (input.budget === 10) throw new Error('backend failed');
    return { selected: [{ chunkId: 'one' }] };
  };
  const client = {
    request: async () => ({ items: [{ chunkId: 'different' }] }),
  };
  await assert.rejects(
    runRecallAudit(
      {},
      client,
      directory,
      directory,
      { split: 'development', budgets: [5, 10] },
      request,
    ),
    /backend failed/,
  );
  const partial = JSON.parse(
    await fs.readFile(path.join(directory, 'recall-traces.json')),
  );
  assert.deepEqual(
    partial.map((r) => r.budget),
    [5],
  );
  await assert.rejects(
    runRecallAudit(
      {},
      client,
      directory,
      directory,
      { split: 'development', budgets: [15] },
      request,
    ),
    /production HTTP selection differ/,
  );
  await assert.rejects(
    runRecallAudit(
      {},
      client,
      directory,
      directory,
      { split: 'absent' },
      request,
    ),
    /No questions/,
  );
});

test('CLI validates recall split and unique bounded integer budgets', () => {
  for (const value of ['0', '101', '1.5', '5,5', 'a', '']) {
    assert.throws(() => options(['--budgets', value]), /Invalid|Usage/);
  }
  assert.throws(() => options(['--split', 'blind']), /Invalid/);
  assert.throws(() => options(['--encoding', 'unsupported']), /Invalid/);
  assert.throws(() => options(['--lexical', 'unsupported']), /Invalid/);
  assert.equal(options(['--lexical', 'cjk']).lexical, 'cjk');
  const parsed = options([
    '--suite',
    'recall',
    '--encoding',
    'nomic-task',
    '--split',
    'validation',
    '--budgets',
    '10,30',
  ]);
  assert.equal(parsed.split, 'validation');
  assert.deepEqual(parsed.budgets, [10, 30]);
});

test('metadata fingerprints include a frozen protocol and reject missing corpus files', async (t) => {
  const directory = await fixture(t);
  await fs.mkdir(path.join(directory, 'docs'));
  await fs.writeFile(path.join(directory, 'docs/a.md'), '# a');
  await fs.writeFile(path.join(directory, 'manifest.json'), '{}');
  const manifest = { documents: [{ file: 'a.md' }] };
  const initial = await hashDataset(directory, manifest);
  assert.equal(Object.hasOwn(initial, 'protocol.json'), false);
  await fs.writeFile(path.join(directory, 'protocol.json'), '{}');
  const withProtocol = await hashDataset(directory, manifest);
  assert.match(withProtocol['protocol.json'], /^[a-f0-9]{64}$/);
  assert.equal(withProtocol['docs/a.md'], initial['docs/a.md']);
  await assert.rejects(
    hashDataset(directory, { documents: [{ file: 'missing.md' }] }),
    /ENOENT/,
  );
});

test('indexed snapshot preserves actual evidence and rejects incomplete or failed reads', async (t) => {
  const directory = await fixture(t);
  const environment = { elasticsearchUrl: 'http://fixture' };
  const request = async () => ({
    ok: true,
    json: async () => ({
      hits: {
        total: { value: 1 },
        hits: [
          {
            _id: 'chunk',
            _source: { document_id: 'doc', content: '真实正文' },
          },
        ],
      },
    }),
  });
  await snapshotIndexedCorpus(environment, directory, request);
  assert.deepEqual(
    JSON.parse(await fs.readFile(path.join(directory, 'indexed-corpus.json'))),
    [{ id: 'chunk', documentId: 'doc', content: '真实正文' }],
  );
  await assert.rejects(
    snapshotIndexedCorpus(environment, directory, async () => ({ ok: false })),
    /Cannot inspect/,
  );
  await assert.rejects(
    snapshotIndexedCorpus(environment, directory, async () => ({
      ok: true,
      json: async () => ({ hits: { total: { value: 2 }, hits: [] } }),
    })),
    /truncated/,
  );
});
