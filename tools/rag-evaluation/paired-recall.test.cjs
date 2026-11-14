const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { pairedOrder, runPairedRecall } = require('./paired-recall.cjs');

async function fixture(t) {
  const output = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-paired-'));
  t.after(() => fs.rm(output, { recursive: true, force: true }));
  return output;
}
const client = {
  user: { id: 'fixture', role: 'ADMIN' },
  request: async () => ({ items: [{ chunkId: 'one' }] }),
};
const questions = [
  { id: 'one', question: 'ERR_AUTH_401是什么？' },
  { id: 'two', question: '如何处理？' },
];

test('paired runner alternates all modes on the same child, retains each repeat separately and uses original HTTP budget', async (t) => {
  const output = await fixture(t),
    calls = [],
    api = {};
  const request = async (child, input) => {
    assert.equal(child, api);
    assert.equal(input.user, client.user);
    calls.push(input);
    return {
      keywordMatchMode: input.keywordMatchMode || 'off',
      selected: [{ chunkId: 'one' }],
    };
  };
  const groups = await runPairedRecall(api, client, questions, output, request);
  assert.equal(groups.length, 6);
  assert.equal(calls.length, 3 + 2 * 3 * 2 + 1);
  assert.deepEqual(
    calls.slice(3, 6).map((c) => c.keywordMatchMode),
    pairedOrder(0, 0),
  );
  assert.deepEqual(
    calls.slice(9, 12).map((c) => c.keywordMatchMode),
    pairedOrder(0, 1),
  );
  assert.equal(calls.at(-1).budget, 15);
  assert.equal(calls.at(-1).keywordMatchMode, undefined);
  for (const group of groups) {
    const rows = JSON.parse(
      await fs.readFile(path.join(group.directory, 'recall-traces.json')),
    );
    assert.deepEqual(
      rows.map((r) => r.id),
      ['one', 'two'],
    );
    assert.ok(
      rows.every(
        (r) => r.keywordMatchMode === group.mode && r.budget === 'k30-s15',
      ),
    );
  }
});

test('paired runner retains partial evidence on backend failure and rejects wrong modes or HTTP parity', async (t) => {
  const output = await fixture(t);
  let calls = 0;
  await assert.rejects(
    runPairedRecall({}, client, questions, output, async (_child, input) => {
      if (++calls === 5) throw new Error('backend unavailable');
      return { keywordMatchMode: input.keywordMatchMode, selected: [] };
    }),
    /backend unavailable/,
  );
  const rows = JSON.parse(
    await fs.readFile(path.join(output, 'off-r1/recall-traces.json')),
  );
  assert.equal(rows.length, 1);
  await assert.rejects(
    runPairedRecall({}, client, [], output),
    /needs questions/,
  );
  const second = await fixture(t);
  await assert.rejects(
    runPairedRecall({}, client, questions, second, async () => ({
      keywordMatchMode: 'bad',
    })),
    /mode mismatch/,
  );
  const third = await fixture(t);
  await assert.rejects(
    runPairedRecall({}, client, questions, third, async (_child, input) => ({
      keywordMatchMode: input.keywordMatchMode,
      selected: [],
    })),
    /production HTTP/,
  );
});
