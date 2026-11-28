const { test } = require('node:test');
const assert = require('node:assert/strict');
const { rollbackBlockers } = require('./rollback-gate.cjs');
const keys = [
  'parseActive',
  'remoteCleanupPending',
  'outboxPending',
  'receiptsIncomplete',
  'plansRunning',
  'upgradeUnfinished',
  'buildsUncertain',
  'queueReady',
  'queueConsumers',
];
const clear = Object.fromEntries(keys.map((k) => [k, 0]));
test('rollback requires every gate explicitly drained, including dead messages and stopped consumers', () => {
  assert.deepEqual(rollbackBlockers(clear), []);
  for (const key of keys) {
    for (const value of [1, undefined, null, -1, NaN])
      assert.deepEqual(rollbackBlockers({ ...clear, [key]: value }), [key]);
  }
});
test('several blockers are reported together; candidate body is retained without active work', () => {
  assert.deepEqual(
    rollbackBlockers({
      ...clear,
      parseActive: 1,
      queueConsumers: 4,
      queueReady: 2,
    }),
    ['parseActive', 'queueReady', 'queueConsumers'],
  );
  assert.deepEqual(
    rollbackBlockers({ ...clear, candidatesNeedingReview: 1 }),
    [],
  );
});
test('snapshot compilation rejects non-pinned references before touching files', async () => {
  const { compileSnapshot } = require('./snapshot.cjs');
  for (const ref of ['HEAD', '--all', 'd825b0f', ''])
    await assert.rejects(
      () => compileSnapshot(ref, '/unused'),
      /Full published commit/,
    );
});
