const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { budgetPair, parseRouteBudgets } = require('./recall-budget.cjs');
const { installRecallHandler } = require('./recall-ipc.cjs');
const { options } = require('./benchmark-options.cjs');

test('route budgets retain each allocation and reject malformed, duplicate or unbounded pairs', () => {
  assert.deepEqual(parseRouteBudgets('15:5,10:10,5:15'), [
    { id: 'k15-s5', keyword: 15, semantic: 5 },
    { id: 10, keyword: 10, semantic: 10 },
    { id: 'k5-s15', keyword: 5, semantic: 15 },
  ]);
  for (const value of ['', '5', 'a:5', '1.5:2', '0:5', '5:101', '5:5,5:5'])
    assert.throws(() => parseRouteBudgets(value), /budget/i);
  assert.throws(() => budgetPair(5, NaN), /integers/);
  assert.throws(
    () =>
      options([
        '--suite',
        'recall',
        '--route-budgets',
        '5:15',
        '--budgets',
        '5',
      ]),
    /cannot combine/,
  );
  assert.throws(() => options(['--route-budgets', '5:15']), /require recall/);
  assert.equal(
    options([
      '--suite',
      'recall',
      '--split',
      'regression',
      '--route-budgets',
      '5:15',
    ]).routeBudgets[0].id,
    'k5-s15',
  );
});

test('IPC applies separate route budgets without changing final selection and rejects partial allocations', async () => {
  const child = new EventEmitter();
  const replies = [];
  const calls = [];
  child.send = (reply) => replies.push(reply);
  const dispose = installRecallHandler(
    child,
    {
      recall: async (query, route, user) => {
        calls.push({ query, route, user });
        return { items: [{ chunkId: route }] };
      },
    },
    {
      rerank: (_q, pool, options) => {
        assert.equal(options.topK, 5);
        return pool;
      },
    },
    (a, b) => [...a, ...b],
  );
  const user = { id: 'test-admin', role: 'ADMIN' };
  child.emit('message', {
    kind: 'recall-audit',
    id: 'pair',
    input: { query: 'test', keywordBudget: 15, semanticBudget: 5, user },
  });
  await new Promise(setImmediate);
  assert.deepEqual(
    calls.map((c) => [c.route, c.query.topK]),
    [
      ['keyword', 15],
      ['semantic', 5],
    ],
  );
  assert.equal(replies[0].trace.keywordBudget, 15);
  assert.equal(replies[0].trace.semanticBudget, 5);
  child.emit('message', {
    kind: 'recall-audit',
    id: 'bad',
    input: { query: 'test', keywordBudget: 15, user },
  });
  await new Promise(setImmediate);
  assert.match(replies[1].error, /Invalid/);
  assert.equal(calls.length, 2);
  dispose();
});
