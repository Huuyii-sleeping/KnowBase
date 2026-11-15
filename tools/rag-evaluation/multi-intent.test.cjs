const test = require('node:test');
const assert = require('node:assert/strict');
const { splitIntents, queryMode, planQueries } = require('./multi-intent.cjs');
const { weaveCandidates, recallIntents } = require('./multi-intent-recall.cjs');

const question = '解析尚未成功的草稿能申请发布审批吗，最终由什么角色批准？';
const user = { id: 'fixture', role: 'ADMIN' };

test('extractive splitting preserves conditions, negation and numbers without inventing shared subjects', () => {
  assert.deepEqual(splitIntents(question), [
    question,
    '解析尚未成功的草稿能申请发布审批吗',
    '最终由什么角色批准',
  ]);
  const q = '未满24小时是否能撤回，审批完成后由谁确认？';
  assert.deepEqual(splitIntents(q), [
    q,
    '未满24小时是否能撤回',
    '审批完成后由谁确认',
  ]);
  for (const q of [
    '单个问题怎么处理？',
    '文件上传成功了，为什么别人搜不到？',
    '先做什么操作，之后怎么处理，最后谁负责确认？',
    '代码`a，b`是什么，应该怎样处理？',
    '“什么，如何”是什么意思？',
    '“没有闭合的问题是什么，应该怎样处理？',
    '这个字段是什么），应该怎样处理？',
    'X'.repeat(513) + question,
  ])
    assert.deepEqual(splitIntents(q), [q]);
  assert.deepEqual(splitIntents('“哪些，如何”是什么意思，应该怎样处理？'), [
    '“哪些，如何”是什么意思，应该怎样处理？',
    '“哪些，如何”是什么意思',
    '应该怎样处理',
  ]);
  assert.throws(() => splitIntents(' '), /non-empty/);
});

test('plans keep original query and never exceed original raw read cap across 1..100 budgets', () => {
  for (let budget = 1; budget <= 100; budget++) {
    const plan = planQueries(question, budget, true);
    assert.equal(plan[0].query, question);
    assert.ok(plan.length === 1 || plan.length === 3);
    assert.ok(plan.every((p) => Number.isInteger(p.budget) && p.budget >= 1));
    assert.ok(
      plan.reduce((n, p) => n + Math.min(3 * p.budget, 100), 0) <=
        Math.min(3 * budget, 100),
    );
  }
  assert.deepEqual(
    planQueries(question, 30, true).map((p) => p.budget),
    [15, 8, 7],
  );
  assert.deepEqual(
    planQueries(question, 15, true).map((p) => p.budget),
    [8, 4, 3],
  );
  assert.deepEqual(planQueries(question, 30, false), [
    { query: question, budget: 30 },
  ]);
  for (const budget of [0, 101, 2.5, NaN])
    assert.throws(() => planQueries(question, budget, true), /budget/);
  assert.throws(() => queryMode('unknown'), /Invalid/);
});

test('route scheduling deduplicates actual chunks, retains native scores and backfills empty branches', () => {
  const original = [
    { id: 'a', score: 9 },
    { id: 'b', score: 8 },
  ];
  const sub = [
    { id: 'a', score: 90 },
    { id: 'c', score: 7 },
  ];
  const other = [
    { id: 'd', score: 6 },
    { id: 'e', score: 5 },
  ];
  assert.deepEqual(
    weaveCandidates([original, sub, other], 5, (c) => c.id),
    [...original, sub[1], ...other],
  );
  assert.deepEqual(
    weaveCandidates([[], sub, []], 10, (c) => c.id),
    sub,
  );
  assert.deepEqual(
    weaveCandidates([[], [], []], 10, (c) => c.id),
    [],
  );
  assert.deepEqual(
    weaveCandidates([original], 1, (c) => c.id),
    original.slice(0, 1),
  );
  assert.equal(sub[0].score, 90);
});

function fixture(failAt = -1) {
  const calls = [];
  return {
    calls,
    recall: async (input, route, identity) => {
      const call = calls.length;
      calls.push({ input, route, identity });
      if (call === failAt) throw new Error('subquery failed');
      const raw = Array.from({ length: input.topK * 3 }, (_, i) => ({
        id: `${call}:${i}`,
        score: 20 - i,
      }));
      const eligible = raw
        .filter((_, i) => i !== 0)
        .map((c) => ({ chunkId: c.id, score: c.score }));
      return {
        rawCandidates: raw,
        eligibleCandidates: eligible,
        items: eligible.slice(0, input.topK),
        elapsedMs: 2,
        timings: { indexMs: 1 },
      };
    },
  };
}

test('only enabled routes split; every branch uses the same identity and eligible candidates', async () => {
  const recall = fixture();
  const semantic = await recallIntents(
    recall,
    question,
    15,
    'semantic',
    user,
    'clauses-keyword',
  );
  assert.equal(semantic.queryPlan.length, 1);
  assert.equal(recall.calls.length, 1);
  recall.calls.length = 0;
  const keyword = await recallIntents(
    recall,
    question,
    30,
    'keyword',
    user,
    'clauses-keyword',
  );
  assert.deepEqual(
    recall.calls.map((c) => c.input.topK),
    [15, 8, 7],
  );
  assert.ok(
    recall.calls.every((c) => c.identity === user && c.route === 'keyword'),
  );
  assert.equal(keyword.items.length, 30);
  assert.ok(keyword.rawCandidates.length <= 90);
  assert.ok(keyword.items.every((c) => !c.chunkId.endsWith(':0')));
  assert.equal(new Set(keyword.items.map((c) => c.chunkId)).size, 30);
  assert.equal(keyword.timings.indexMs, 3);
  const both = fixture();
  await recallIntents(both, question, 15, 'semantic', user, 'clauses-both');
  assert.equal(both.calls.length, 3);
});

test('branch failures or incomplete safety diagnostics fail the whole experiment', async () => {
  const recall = fixture(1);
  await assert.rejects(
    recallIntents(recall, question, 30, 'keyword', user, 'clauses-both'),
    /subquery failed/,
  );
  assert.equal(recall.calls.length, 3);
  await assert.rejects(
    recallIntents(
      { recall: async () => ({ rawCandidates: [], items: [] }) },
      question,
      30,
      'keyword',
      user,
      'clauses-both',
    ),
    /eligibility/,
  );
  await assert.rejects(
    recallIntents(fixture(), question, 30, 'keyword', user, 'bad'),
    /Invalid/,
  );
});
