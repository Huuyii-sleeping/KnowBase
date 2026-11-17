// Business adapter contract test on frozen pools. No fresh retrieval or answer generation.
const fs = require('node:fs/promises');
const path = require('node:path');
const { createRequire } = require('node:module');
const { createHash } = require('node:crypto');
const { createServer } = require('node:http');
const assert = require('node:assert/strict');

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const read = async (file) => JSON.parse(await fs.readFile(file, 'utf8'));

async function run(root, protocol, mode, output) {
  if (!['replay', 'live'].includes(mode))
    throw new Error('mode must be replay or live');
  for (const [file, expected] of Object.entries(protocol.files_sha256)) {
    assert.equal(
      hash(await fs.readFile(path.join(root, file))),
      expected,
      file,
    );
  }
  const apiRequire = createRequire(path.join(root, 'apps/api/package.json'));
  apiRequire('reflect-metadata');
  const { ConfigService } = apiRequire('@nestjs/config');
  const modules = path.join(root, 'apps/api/dist/src/modules');
  const { BgeHttpService, BGE_MODEL } = require(
    path.join(modules, 'retrieval/rerank/bge-http.service.js'),
  );
  const { HybridRerankService } = require(
    path.join(modules, 'retrieval/rerank/hybrid-rerank.service.js'),
  );
  const { RerankService } = require(
    path.join(modules, 'retrieval/rerank/rerank.service.js'),
  );
  const { HybridSearchService } = require(
    path.join(modules, 'search/hybrid-search.service.js'),
  );
  const { mergeChunkCandidates } = require(
    path.join(modules, 'search/hybrid-candidates.js'),
  );
  const { AnswerGroundingService } = require(
    path.join(modules, 'answer/answer-grounding.service.js'),
  );
  const replay = await read(path.join(root, protocol.replay));
  const scores = await read(path.join(root, protocol.model_scores));
  const parent = await read(path.join(root, protocol.model_protocol));
  assert.equal(scores.complete, true);
  assert.equal(scores.protocol_sha256, hash(JSON.stringify(parent)));
  const all = replay.sources.flatMap((source) =>
    source.rows.map((row) => ({ source, row })),
  );
  assert.equal(all.length, scores.rows.length);
  all.forEach(({ source, row }, index) => {
    const result = scores.rows[index];
    assert.equal(result.source, source.id);
    assert.equal(result.id, row.id);
    assert.deepEqual(
      result.pair_keys,
      row.pool.map((p) =>
        hash(
          JSON.stringify([
            parent.queries[source.id][row.id],
            p.title,
            p.content || '',
          ]),
        ),
      ),
    );
  });
  const chosen =
    mode === 'live'
      ? protocol.live_cases.map((c) => {
          const entry = all.find(
            ({ source, row }) => source.id === c.source && row.id === c.id,
          );
          assert.ok(entry, 'Missing frozen live case');
          return entry;
        })
      : all;
  const results = [];
  let current;
  let server;
  let endpoint = protocol.endpoint;
  if (mode === 'replay') {
    server = createServer(async (request, response) => {
      try {
        let data = '';
        for await (const part of request) data += part;
        const body = JSON.parse(data);
        assert.equal(request.url, '/rerank');
        assert.equal(body.query, current.query);
        assert.deepEqual(
          body.candidates,
          current.row.pool.map((p) => ({
            id: p.chunkId,
            title: p.title,
            content: p.content || '',
          })),
        );
        response.setHeader('content-type', 'application/json');
        response.end(
          JSON.stringify({
            requestId: body.requestId,
            model: BGE_MODEL,
            scores: current.row.pool.map((p, i) => ({
              id: p.chunkId,
              score: current.scored.scores[i],
            })),
          }),
        );
      } catch {
        response.writeHead(500);
        response.end('{}');
      }
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    endpoint = `http://127.0.0.1:${server.address().port}`;
  }
  const provider = new BgeHttpService(
    new ConfigService({
      RAG_RERANKER: 'bge',
      BGE_RERANK_URL: endpoint,
      BGE_RERANK_TIMEOUT_MS: protocol.timeout_ms,
    }),
  );
  const rule = new RerankService();
  const service = new HybridRerankService(rule, provider);
  const grounding = new AnswerGroundingService();
  const score = provider.score.bind(provider);
  let modelCalls = 0;
  provider.score = async (...args) => {
    modelCalls++;
    return score(...args);
  };
  try {
    for (const { source, row } of chosen) {
      const query = parent.queries[source.id][row.id];
      current = {
        query,
        row,
        scored:
          scores.rows[
            all.findIndex(
              (x) => x.source.id === source.id && x.row.id === row.id,
            )
          ],
      };
      const toRoute = (route) =>
        row.pool
          .filter((p) => p.sources.includes(route))
          .map((p) => ({
            chunkId: p.chunkId,
            documentId: p.documentId,
            documentVersion: 1,
            chunkIndex: p.chunkIndex,
            content: p.content,
            score: route === 'keyword' ? p.keywordScore : p.semanticScore,
            document: {
              title: p.title,
              category: p.category,
              team: p.team,
              tags: p.tags,
            },
          }));
      const keyword = toRoute('keyword'),
        semantic = toRoute('semantic');
      assert.deepEqual(mergeChunkCandidates(keyword, semantic), row.pool);
      const user = { id: 'integration-fixture', role: 'ADMIN', team: null };
      const route = (items) => async (input, identity) => {
        assert.equal(identity, user);
        assert.deepEqual(input, { query, topK: 15 });
        return { items };
      };
      const hybrid = new HybridSearchService(
        {
          searchKeywordChunks: route(keyword),
          search: route(semantic),
        },
        service,
      );
      const beforeCalls = modelCalls;
      const started = performance.now();
      const result = await hybrid.search({ query, topK: 5 }, user);
      const elapsedMs = performance.now() - started;
      assert.equal(
        modelCalls,
        beforeCalls + 1,
        'Model request bypassed or circuit open',
      );
      assert.ok(
        result.items.every((item) => Number.isFinite(item.rerankModelScore)),
        'Unexpected fallback',
      );
      const expected = row.options['bge-m3-anchor2-model-order'].selected;
      assert.deepEqual(
        result.items.map((item) => item.chunkId),
        expected,
        `${source.id}/${row.id}`,
      );
      const pool = new Map(row.pool.map((p) => [p.chunkId, p]));
      result.items.forEach((item, i) => {
        const original = pool.get(item.chunkId);
        for (const key of [
          'content',
          'title',
          'documentId',
          'sources',
          'keywordScore',
          'semanticScore',
        ])
          assert.deepEqual(item[key], original[key], key);
        assert.equal(
          item.rerankScore,
          (result.items.length - i) / (result.items.length + 1),
        );
        const j = row.pool.findIndex((p) => p.chunkId === item.chunkId);
        assert.ok(
          Math.abs(item.rerankModelScore - current.scored.scores[j]) <=
            protocol.max_logit_delta,
        );
      });
      const baseline = rule.rerank(query, row.pool, { topK: 5 });
      const actualGrounded = grounding.selectSupportedItems(
        query,
        result.items,
      );
      const baselineGrounded = grounding.selectSupportedItems(query, baseline);
      results.push({
        source: source.id,
        id: row.id,
        elapsed_ms: elapsedMs,
        selected: result.items.map((p) => p.chunkId),
        baseline_grounded: baselineGrounded.map((p) => p.chunkId),
        bge_grounded: actualGrounded.map((p) => p.chunkId),
        max_selected_logit_delta: Math.max(
          0,
          ...result.items.map((item) =>
            Math.abs(
              item.rerankModelScore -
                current.scored.scores[
                  row.pool.findIndex((p) => p.chunkId === item.chunkId)
                ],
            ),
          ),
        ),
      });
      if (mode === 'live')
        console.log(
          JSON.stringify({
            completed: results.length,
            total: chosen.length,
            id: row.id,
            elapsed_ms: Math.round(elapsedMs),
          }),
        );
    }
  } finally {
    if (server) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  }
  const result = {
    complete: true,
    mode,
    protocol_sha256: hash(JSON.stringify(protocol)),
    scope:
      mode === 'live'
        ? 'Real local model HTTP inference on fixed-pool smoke cases; stubbed retrieval routes, real hybrid/rerank/grounding services; no generated answers or live ACL retest'
        : 'All frozen pools through real HTTP client and hybrid/rerank/grounding; HTTP fixture reuses pinned prior model scores, NOT fresh model inference or online retrieval',
    rows: results,
  };
  await fs.writeFile(output, JSON.stringify(result) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ complete: true, mode, rows: results.length }));
  return result;
}

if (require.main === module) {
  (async () => {
    const [protocolFile, mode, output] = process.argv.slice(2);
    if (!protocolFile || !mode || !output)
      throw new Error('usage: protocol replay|live output');
    await run(
      path.resolve(__dirname, '../..'),
      await read(protocolFile),
      mode,
      output,
    );
  })().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { run };
