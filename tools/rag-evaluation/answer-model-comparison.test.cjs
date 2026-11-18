const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  caseItems,
  measureAnswer,
  promptInput,
} = require('./answer-model-comparison.cjs');

test('model comparison retains full original evidence, source identities and stable strategy order', () => {
  const row = {
    pool: [
      { chunkId: 'a', content: 'first', documentId: 'd' },
      { chunkId: 'b', content: 'second', documentId: 'd' },
    ],
    options: {
      rule: { selected: ['a', 'b'] },
      'bge-m3-anchor2-model-order': { selected: ['b', 'a'] },
    },
  };
  const before = structuredClone(row);
  const old = { baseline_grounded: ['a'] };
  assert.deepEqual(
    caseItems(row, old, 'rule_single').map((p) => p.chunkId),
    ['a'],
  );
  assert.deepEqual(
    caseItems(row, old, 'bge_multi').map((p) => [p.chunkId, p.content]),
    [
      ['b', 'second'],
      ['a', 'first'],
    ],
  );
  assert.deepEqual(
    caseItems(row, old, 'rule_multi').map((p) => p.chunkId),
    ['a', 'b'],
  );
  assert.deepEqual(row, before);
  assert.throws(() => caseItems(row, old, 'unknown'));
  row.options.rule.selected = ['a', 'a'];
  assert.throws(() => caseItems(row, old, 'rule_multi'), /duplicate/);
  row.options.rule.selected = ['outside'];
  assert.throws(() => caseItems(row, old, 'rule_multi'), /outside/);
});

test('failed generation counts as a provider error, never as an answer or refusal', async () => {
  const result = { answer: '事实 [S1]', citations: [] };
  assert.deepEqual(
    (await measureAnswer({ answer: async () => result }, 'question')).result,
    result,
  );
  const failed = await measureAnswer(
    {
      answer: async () => {
        throw new Error('incomplete stream');
      },
    },
    'question',
  );
  assert.equal(failed.status, 'provider_error');
  assert.equal(failed.result, null);
  assert.ok(failed.elapsed_ms >= 0);
});

test('role diagnostic preserves all instruction/query/evidence text and refuses unknown formats', () => {
  const prompt =
    'instruction\nsecond instruction\n\n问题：question\n\n问题：quoted question\n\n知识库上下文：body';
  assert.equal(promptInput(prompt), prompt);
  const messages = promptInput(prompt, 'roles');
  assert.deepEqual(
    messages.map((m) => m.role),
    ['system', 'user'],
  );
  assert.equal(messages.map((m) => m.content).join('\n\n'), prompt);
  assert.throws(() => promptInput('no boundary', 'roles'));
  assert.throws(() => promptInput(prompt, 'unknown'));
});
