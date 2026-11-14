const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { requestRecall, installRecallHandler } = require('./recall-ipc.cjs');

test('IPC correlates concurrent replies and removes listeners after completion', async () => {
  const child = new EventEmitter();
  const requests = [];
  child.send = (message) => requests.push(message);
  const first = requestRecall(child, { query: 'one' });
  const second = requestRecall(child, { query: 'two' });
  child.emit('message', { id: 'unrelated', trace: {} });
  child.emit('message', { id: requests[1].id, trace: 'two' });
  child.emit('message', { id: requests[0].id, trace: 'one' });
  assert.deepEqual(await Promise.all([first, second]), ['one', 'two']);
  assert.equal(child.listenerCount('message'), 0);
  assert.equal(child.listenerCount('exit'), 0);
});

test('IPC removes listeners on timeouts, exits and send errors', async () => {
  for (const mode of ['timeout', 'exit', 'send', 'reply']) {
    const child = new EventEmitter();
    child.send = (message, callback) => {
      if (mode === 'send') callback(new Error('send failed'));
      if (mode === 'reply')
        process.nextTick(() =>
          child.emit('message', { id: message.id, error: 'remote failed' }),
        );
    };
    const result = requestRecall(child, {}, 10);
    if (mode === 'exit') child.emit('exit');
    await assert.rejects(result, /timed out|exited|send failed|remote failed/);
    assert.equal(child.listenerCount('message'), 0);
    assert.equal(child.listenerCount('exit'), 0);
  }
});

test('isolated handler calls both real route contracts, merges before selection and validates input', async () => {
  const child = new EventEmitter();
  const replies = [];
  child.send = (reply) => replies.push(reply);
  const calls = [];
  const recall = {
    recall: async (...args) => {
      calls.push(args);
      return { items: [{ chunkId: args[1], content: 'body' }] };
    },
  };
  const rerank = {
    rerank: (query, pool, options) => {
      assert.equal(query, 'query');
      assert.equal(options.topK, 5);
      return pool.slice(0, 1);
    },
  };
  const dispose = installRecallHandler(
    child,
    recall,
    rerank,
    (keyword, semantic) => [...keyword, ...semantic],
  );
  child.emit('message', { kind: 'unrelated' });
  child.emit('message', {
    kind: 'recall-audit',
    id: 'valid',
    input: { query: 'query', budget: 15, user: { id: 'admin', role: 'ADMIN' } },
  });
  await new Promise(setImmediate);
  assert.deepEqual(
    calls.map((call) => call[1]),
    ['keyword', 'semantic'],
  );
  assert.deepEqual(
    replies[0].trace.pool.map((item) => item.chunkId),
    ['keyword', 'semantic'],
  );
  assert.equal(replies[0].trace.selected.length, 1);
  for (const input of [
    { budget: 0 },
    { budget: 101 },
    { budget: 5, user: { id: 'member', role: 'MEMBER' } },
  ]) {
    child.emit('message', { kind: 'recall-audit', id: 'invalid', input });
  }
  await new Promise(setImmediate);
  assert.ok(replies.slice(1).every((reply) => /Invalid/.test(reply.error)));
  dispose();
  assert.equal(child.listenerCount('message'), 0);
});

test('isolated handler reports dependency failures instead of fabricating an empty result', async () => {
  const child = new EventEmitter();
  let reply;
  child.send = (value) => {
    reply = value;
  };
  installRecallHandler(
    child,
    {
      recall: async () => {
        throw new Error('store failed');
      },
    },
    {},
    () => [],
  );
  child.emit('message', {
    kind: 'recall-audit',
    id: 'fail',
    input: { query: 'query', budget: 5, user: { id: 'admin', role: 'ADMIN' } },
  });
  await new Promise(setImmediate);
  assert.equal(reply.error, 'store failed');
});

test('keyword reduction changes one route only and preserves identity, budgets and rerank query', async () => {
  const child = new EventEmitter(),
    replies = [],
    calls = [];
  child.send = (reply) => replies.push(reply);
  const query = '未满24小时怎么撤回，N-123_v2不能删除吗？';
  const user = { id: 'fixture', role: 'ADMIN' };
  const dispose = installRecallHandler(
    child,
    {
      recall: async (input, route, identity) => {
        calls.push({ input, route, identity });
        return { items: [] };
      },
    },
    {
      rerank: (text, pool) => {
        assert.equal(text, query);
        return pool;
      },
    },
    (a, b) => [...a, ...b],
  );
  const input = {
    query,
    user,
    keywordBudget: 30,
    semanticBudget: 15,
    keywordQueryMode: 'trim-question',
  };
  child.emit('message', { kind: 'recall-audit', id: 'valid', input });
  await new Promise(setImmediate);
  assert.deepEqual(
    calls.map((c) => [c.input, c.route]),
    [
      [{ query: '未满24小时 撤回，N-123_v2不能删除 ？', topK: 30 }, 'keyword'],
      [{ query, topK: 15 }, 'semantic'],
    ],
  );
  assert.ok(calls.every((c) => c.identity === user));
  assert.equal(replies[0].trace.originalQuery, query);
  assert.equal(replies[0].trace.keywordQueryMode, 'trim-question');
  assert.equal(
    replies[0].trace.keyword.queryPlan[0].query,
    calls[0].input.query,
  );
  for (const patch of [
    { keywordQueryMode: 'bad' },
    { queryMode: 'clauses-both' },
  ]) {
    child.emit('message', {
      kind: 'recall-audit',
      id: 'bad',
      input: { ...input, ...patch },
    });
    await new Promise(setImmediate);
    assert.match(replies.at(-1).error, /Invalid/);
  }
  assert.equal(calls.length, 2);
  dispose();
});

test('multi-intent IPC preserves user scope, original rerank query and total budgets; invalid mode never queries', async () => {
  const child = new EventEmitter(),
    replies = [],
    calls = [];
  child.send = (reply) => replies.push(reply);
  const query = '解析尚未成功的草稿能申请发布审批吗，最终由什么角色批准？';
  const user = { id: 'fixture-admin', role: 'ADMIN' };
  const dispose = installRecallHandler(
    child,
    {
      recall: async (input, route, identity) => {
        calls.push({ input, route, identity });
        return {
          rawCandidates: [],
          eligibleCandidates: [],
          items: [],
          elapsedMs: 1,
          timings: {},
        };
      },
    },
    {
      rerank: (text, pool, options) => {
        assert.equal(text, query);
        assert.equal(options.topK, 5);
        return pool;
      },
    },
    (a, b) => [...a, ...b],
  );
  child.emit('message', {
    kind: 'recall-audit',
    id: 'split',
    input: {
      query,
      user,
      keywordBudget: 30,
      semanticBudget: 15,
      queryMode: 'clauses-both',
    },
  });
  await new Promise(setImmediate);
  assert.equal(calls.length, 6);
  assert.ok(calls.every((c) => c.identity === user));
  assert.equal(replies[0].trace.queryMode, 'clauses-both');
  assert.equal(replies[0].trace.keyword.topK, 30);
  assert.equal(replies[0].trace.semantic.topK, 15);
  child.emit('message', {
    kind: 'recall-audit',
    id: 'bad',
    input: { query, user, budget: 15, queryMode: 'bad' },
  });
  await new Promise(setImmediate);
  assert.match(replies[1].error, /Invalid/);
  assert.equal(calls.length, 6);
  dispose();
});
