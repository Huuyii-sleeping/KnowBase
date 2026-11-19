const { test } = require('node:test');
const assert = require('node:assert/strict');
const { selectVariant, refine } = require('./rerank-refinement.cjs');

const row = {
  id: 'q',
  pool: ['a', 'b', 'c', 'd'].map((chunkId, i) => ({ chunkId, documentId: i < 3 ? 'one' : 'two', content: 'body', title: 'T' })),
  options: {
    rule: { selected: ['a', 'b', 'd'] },
    'bge-m3': { decisions: ['a', 'b', 'c', 'd'].map((chunkId, i) => ({ chunkId, score: i })) },
    'bge-m3-anchor2-model-order': { selected: ['d', 'b', 'a'] },
  },
};

test('admission varies one constraint and final scores order unchanged full bodies', () => {
  const original = structuredClone(row);
  const scores = [0, 1, 4, 3];
  assert.deepEqual(selectVariant(row, scores, {}, { topK: 3 }).selected, ['d', 'b', 'a']);
  assert.deepEqual(selectVariant(row, scores, { constraints: { maxChunksPerDocument: 3 } }, { topK: 3 }).selected, ['c', 'b', 'a']);
  assert.deepEqual(row, original);
  assert.throws(() => selectVariant(row, [1], {}, { topK: 3 }), /Incomplete/);
  assert.throws(() => selectVariant(row, [1, 2, 3, NaN], {}, { topK: 3 }), /nonfinite/);
});

test('input scores retain pool identities and reject duplicates or substitutions', () => {
  const replay = { sources: [{ id: 's', rows: [row] }] };
  const protocol = { constraints: { topK: 3 }, input_variants: [{ id: 'body' }] };
  const scores = [{ source: 's', id: 'q', chunk_ids: ['a', 'b', 'c', 'd'], variants: { body: { scores: [0, 1, 4, 3] } } }];
  assert.deepEqual(refine(replay, protocol, scores)[0].rows[0].options.body.selected, ['d', 'b', 'a']);
  assert.throws(() => refine(replay, protocol, [...scores, ...scores]), /Duplicate/);
  assert.throws(() => refine(replay, protocol, [{ ...scores[0], chunk_ids: ['other'] }]), /identity/);
});
