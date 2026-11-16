const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const {
  STRATEGIES,
  grams,
  similarity,
  rankStrategy,
  selectRanked,
} = require('./rerank-policies.cjs');
const { hash, readSource, replayTrace } = require('./rerank-replay.cjs');

const candidate = (
  id,
  documentId = id,
  content = 'some content',
  score = 1,
) => ({
  chunkId: id,
  documentId,
  content,
  rerankScore: score,
  keywordScore: 2,
  semanticScore: 0.5,
  score: 1,
  title: 'Guide',
  tags: [],
  category: null,
  team: null,
  sources: ['keyword', 'semantic'],
});

test('selection preserves production caps, first oversized item, stable ranks and input', () => {
  const ranked = [
    candidate('a', 'doc', '12345'),
    candidate('b', 'doc', '1'),
    candidate('c', 'doc', '2'),
    candidate('d', 'other', '34'),
    candidate('e'),
  ];
  const original = structuredClone(ranked);
  const result = selectRanked(ranked, { topK: 3, maxContextCharacters: 6 });
  assert.deepEqual(
    result.selected.map((i) => i.chunkId),
    ['a', 'b'],
  );
  assert.deepEqual(
    result.decisions.map((i) => i.reason),
    [
      'selected',
      'selected',
      'document_cap',
      'character_budget',
      'character_budget',
    ],
  );
  assert.deepEqual(ranked, original);
  assert.equal(
    selectRanked(ranked, { maxContextCharacters: 2 }).selected[0].chunkId,
    'a',
  );
  assert.equal(selectRanked(ranked, { topK: 1 }).decisions[1].reason, 'top_k');
  assert.deepEqual(selectRanked([]).selected, []);
});

test('RRF uses actual route order and stable ties rather than raw score magnitude', () => {
  const pool = [candidate('a'), candidate('b')];
  const trace = {
    keyword: { items: [pool[1], pool[0]] },
    semantic: { items: [pool[0], pool[1]] },
  };
  const result = rankStrategy(
    pool,
    trace,
    STRATEGIES.find((s) => s.id === 'rrf'),
  );
  assert.deepEqual(
    result.map((i) => i.chunkId),
    ['a', 'b'],
  );
  assert.equal(result[0].rerankScore, 1 / 61 + 1 / 62);
  assert.equal(
    rankStrategy(
      pool,
      trace,
      STRATEGIES.find((s) => s.id === 'keyword-first'),
    )[0].chunkId,
    'b',
  );
  const noDual = rankStrategy(
    pool,
    trace,
    STRATEGIES.find((s) => s.id === 'rule-no-dual'),
  );
  assert.equal(noDual[0].rerankScore, 0.9);
});

test('diversity penalizes repeated body text without using titles or gold labels', () => {
  const pool = [
    candidate('a', 'a', 'identical paragraph', 1),
    candidate('b', 'b', 'identical paragraph', 0.99),
    candidate('c', 'c', 'complementary evidence', 0.9),
  ];
  assert.deepEqual(
    selectRanked(pool, { topK: 2, relevance: 0.85 }).selected.map(
      (i) => i.chunkId,
    ),
    ['a', 'c'],
  );
  assert.equal(similarity(grams(''), grams('')), 0);
  assert.equal(similarity(grams('Ａ B'), grams('a b')), 1);
});

test('replay rejects pool and selected-result drift using real application modules', () => {
  const {
    RerankService,
  } = require('../../apps/api/dist/src/modules/retrieval/rerank/rerank.service.js');
  const {
    mergeChunkCandidates,
  } = require('../../apps/api/dist/src/modules/search/hybrid-candidates.js');
  const route = [
    {
      chunkId: 'c1',
      documentId: 'd1',
      content: 'known evidence',
      chunkIndex: 0,
      score: 1,
      document: { title: 'Guide', tags: [], category: null, team: null },
    },
  ];
  const trace = {
    id: 'q1',
    originalQuery: 'known',
    keyword: { items: route },
    semantic: { items: route },
  };
  trace.pool = mergeChunkCandidates(route, route);
  trace.selected = new RerankService().rerank('known', trace.pool, { topK: 5 });
  const result = replayTrace(trace, new RerankService(), mergeChunkCandidates);
  assert.deepEqual(result.options.rule.selected, ['c1']);
  assert.equal(Object.keys(result.options).length, STRATEGIES.length);
  assert.throws(
    () =>
      replayTrace(
        { ...trace, pool: [] },
        new RerankService(),
        mergeChunkCandidates,
      ),
    /pool differs/,
  );
  assert.throws(
    () =>
      replayTrace(
        { ...trace, selected: [] },
        new RerankService(),
        mergeChunkCandidates,
      ),
    /selection differs/,
  );
});

test('source loader validates completed status, gzip bytes, corpus fingerprints and query identity', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rerank-fixture-'));
  try {
    await fs.mkdir(path.join(root, 'run'));
    await fs.mkdir(path.join(root, 'dataset'));
    const questions = JSON.stringify([
      { id: 'q', question: 'original', split: 'development' },
    ]);
    const metadata = JSON.stringify({
      corpus_sha256: { 'questions.json': hash(questions) },
      recall_audit: { split: 'all' },
    });
    const traces = JSON.stringify([
      {
        id: 'q',
        budget: 15,
        originalQuery: 'original',
        queryMode: 'off',
        keywordQueryMode: 'off',
        keywordMatchMode: 'off',
      },
    ]);
    await fs.writeFile(path.join(root, 'dataset/questions.json'), questions);
    await fs.writeFile(path.join(root, 'run/metadata.json'), metadata);
    await fs.writeFile(
      path.join(root, 'run/run-status.json'),
      '{"status":"completed"}',
    );
    await fs.writeFile(
      path.join(root, 'run/recall-traces.json.gz'),
      zlib.gzipSync(traces),
    );
    const source = {
      run: 'run',
      dataset: 'dataset',
      budget: 15,
      trace_sha256: hash(traces),
      files_sha256: { 'metadata.json': hash(metadata) },
    };
    assert.equal((await readSource(root, source)).traces.length, 1);
    await assert.rejects(
      readSource(root, { ...source, trace_sha256: 'wrong' }),
      /trace fingerprint/,
    );
    await fs.writeFile(
      path.join(root, 'run/run-status.json'),
      '{"status":"running"}',
    );
    await assert.rejects(readSource(root, source), /not completed/);
    await fs.writeFile(
      path.join(root, 'run/run-status.json'),
      '{"status":"completed"}',
    );
    const wrong = traces.replace(
      'originalQuery":"original',
      'originalQuery":"changed',
    );
    await fs.writeFile(
      path.join(root, 'run/recall-traces.json.gz'),
      zlib.gzipSync(wrong),
    );
    await assert.rejects(
      readSource(root, { ...source, trace_sha256: hash(wrong) }),
      /Query differs/,
    );
    await fs.writeFile(path.join(root, 'dataset/questions.json'), '[]');
    await assert.rejects(readSource(root, source), /Dataset fingerprint/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
