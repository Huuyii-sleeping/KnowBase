const test = require('node:test');
const assert = require('node:assert/strict');
const { phraseTargets, phraseRequest } = require('./phrase-match.cjs');
const { createPhraseSearch } = require('./phrase-recall.cjs');

const input = () => ({
  index: 'chunks',
  size: 90,
  query: {
    bool: {
      must: [
        {
          match: {
            'content.cjk': {
              query: 'parseStatus=READY 是否才能提交“发布审核”？',
            },
          },
        },
      ],
      filter: [{ terms: { generation_id: ['current-allowed'] } }],
    },
  },
});

test('extracts bounded literal identifiers and explicit phrases without changing conditions', () => {
  assert.deepEqual(
    phraseTargets('parseStatus=READY 是否才能提交“发布审核”？', 'identifiers'),
    [{ text: 'parseStatus=READY', kind: 'identifier' }],
  );
  assert.deepEqual(
    phraseTargets(
      'parseStatus=READY 是否才能提交“发布审核”？',
      'identifiers-phrases',
    ),
    [
      { text: '发布审核', kind: 'quoted-phrase' },
      { text: 'parseStatus=READY', kind: 'identifier' },
    ],
  );
  assert.deepEqual(
    phraseTargets('未满24小时能否提交？', 'identifiers-phrases'),
    [],
  );
  assert.equal(phraseTargets('A_1 A_2 A_3 A_4 A_5', 'identifiers').length, 4);
  assert.deepEqual(phraseTargets('A'.repeat(513), 'identifiers'), []);
  assert.deepEqual(
    phraseTargets('/api/v1/tasks/retry 和 ERR_AUTH_401', 'identifiers').map(
      (t) => t.text,
    ),
    ['/api/v1/tasks/retry', 'ERR_AUTH_401'],
  );
  assert.throws(() => phraseTargets('', 'identifiers'), /non-empty/);
  assert.throws(() => phraseTargets('query', 'bad'), /Invalid/);
});

test('adds optional zero-slop phrase clauses, keeps mandatory original query, size, field and generation filters; does not mutate input', () => {
  const original = input(),
    snapshot = JSON.stringify(original);
  const enhanced = phraseRequest(original, 'identifiers-phrases');
  assert.equal(JSON.stringify(original), snapshot);
  assert.equal(enhanced.size, 90);
  assert.deepEqual(enhanced.query.bool.filter, original.query.bool.filter);
  assert.deepEqual(
    enhanced.query.bool.must[0].bool.must,
    original.query.bool.must,
  );
  assert.equal(enhanced.query.bool.must[0].bool.minimum_should_match, 0);
  assert.deepEqual(enhanced.query.bool.must[0].bool.should[1], {
    match_phrase: {
      'content.cjk': { query: 'parseStatus=READY', slop: 0, boost: 2 },
    },
  });
  assert.equal(phraseRequest(original, 'off'), original);
  original.query.bool.must[0].match['content.cjk'].query =
    '未满24小时是否允许？';
  assert.equal(phraseRequest(original, 'identifiers-phrases'), original);
  assert.throws(
    () => phraseRequest({ query: {} }, 'identifiers'),
    /single CJK/,
  );
});

test('isolated adapter serializes only the search body and propagates HTTP/transport failures', async () => {
  let call;
  const search = createPhraseSearch(
    'http://fixture',
    'identifiers',
    async (...args) => {
      call = args;
      return { ok: true, json: async () => ({ hits: { hits: [] } }) };
    },
  );
  assert.deepEqual(await search(input()), { hits: { hits: [] } });
  assert.equal(call[0], 'http://fixture/chunks/_search');
  const body = JSON.parse(call[1].body);
  assert.equal(body.index, undefined);
  assert.equal(body.size, 90);
  assert.deepEqual(body.query.bool.filter, input().query.bool.filter);
  await assert.rejects(
    createPhraseSearch('http://fixture', 'identifiers', async () => ({
      ok: false,
      status: 503,
    }))(input()),
    /HTTP 503/,
  );
  await assert.rejects(
    createPhraseSearch('http://fixture', 'identifiers', async () => {
      throw new Error('unavailable');
    })(input()),
    /unavailable/,
  );
});
