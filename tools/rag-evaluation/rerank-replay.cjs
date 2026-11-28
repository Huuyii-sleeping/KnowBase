const fs = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');
const { createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const {
  STRATEGIES,
  rankStrategy,
  selectRanked,
} = require('./rerank-policies.cjs');

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = async (file) => JSON.parse(await fs.readFile(file, 'utf8'));

async function readSource(root, source) {
  const directory = path.resolve(root, source.run);
  if (
    (await json(path.join(directory, 'run-status.json'))).status !== 'completed'
  )
    throw new Error('Source run is not completed');
  for (const [file, expected] of Object.entries(source.files_sha256)) {
    if (hash(await fs.readFile(path.join(directory, file))) !== expected)
      throw new Error(`Source file fingerprint mismatch: ${file}`);
  }
  const metadata = await json(path.join(directory, 'metadata.json'));
  for (const [file, expected] of Object.entries(metadata.corpus_sha256)) {
    if (
      hash(await fs.readFile(path.resolve(root, source.dataset, file))) !==
      expected
    )
      throw new Error(`Dataset fingerprint mismatch: ${file}`);
  }
  let bytes;
  try {
    bytes = await fs.readFile(path.join(directory, 'recall-traces.json'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    bytes = zlib.gunzipSync(
      await fs.readFile(path.join(directory, 'recall-traces.json.gz')),
    );
  }
  if (hash(bytes) !== source.trace_sha256)
    throw new Error('Source trace fingerprint mismatch');
  const questions = await json(
    path.resolve(root, source.dataset, 'questions.json'),
  );
  const traces = JSON.parse(bytes).filter((t) => t.budget === source.budget);
  const split = metadata.recall_audit.split;
  const expected = questions.filter(
    (q) => split === 'all' || q.split === split,
  );
  if (
    traces.length !== expected.length ||
    new Set(traces.map((t) => t.id)).size !== traces.length
  )
    throw new Error('Incomplete or duplicate source traces');
  const lookup = new Map(expected.map((q) => [q.id, q]));
  for (const trace of traces) {
    if (
      !lookup.has(trace.id) ||
      trace.originalQuery !== lookup.get(trace.id).question
    )
      throw new Error('Query differs from frozen dataset');
    if (
      ['queryMode', 'keywordQueryMode', 'keywordMatchMode'].some(
        (key) => trace[key] !== 'off',
      )
    )
      throw new Error('Only original-query baseline traces are allowed');
  }
  return { metadata, traces, questions };
}

function replayTrace(trace, rerank, merge) {
  const pool = merge(trace.keyword.items, trace.semantic.items);
  if (!isDeepStrictEqual(pool, trace.pool))
    throw new Error('Merged pool differs from frozen trace');
  const baseline = rerank.rerank(trace.originalQuery, pool, { topK: 5 });
  if (!isDeepStrictEqual(baseline, trace.selected))
    throw new Error('Production selection differs from frozen trace');
  const ranked = rerank.rerank(trace.originalQuery, pool, {
    topK: pool.length,
    maxChunksPerDocument: Number.MAX_SAFE_INTEGER,
    maxContextCharacters: Number.MAX_SAFE_INTEGER,
  });
  const byId = new Map(ranked.map((item) => [item.chunkId, item]));
  // Give every alternative the exact original pool order for deterministic ties.
  const scoredPool = pool.map((item) => byId.get(item.chunkId));
  const options = {};
  for (const strategy of STRATEGIES) {
    const started = performance.now();
    const rank = rankStrategy(scoredPool, trace, strategy);
    const result = selectRanked(rank, strategy);
    const elapsedMs = performance.now() - started;
    if (strategy.id === 'rule' && !isDeepStrictEqual(result.selected, baseline))
      throw new Error('Selection diagnostics differ from production');
    options[strategy.id] = {
      selected: result.selected.map((i) => i.chunkId),
      decisions: result.decisions,
      characters: result.characters,
      elapsedMs,
    };
  }
  return { id: trace.id, pool, options };
}

async function replay(root, protocol, output) {
  const modules = path.join(root, 'apps/api/dist/src');
  const { RerankService } = require(
    path.join(modules, 'modules/retrieval/rerank/rerank.service.js'),
  );
  const { mergeChunkCandidates } = require(
    path.join(modules, 'modules/search/hybrid-candidates.js'),
  );
  if (!isDeepStrictEqual(STRATEGIES, protocol.strategies))
    throw new Error('Strategy protocol differs from implementation');
  await fs.mkdir(output, { recursive: true });
  const result = {
    protocol_sha256: hash(JSON.stringify(protocol)),
    sources: [],
  };
  for (const source of protocol.sources) {
    const { metadata, traces } = await readSource(root, source);
    const rows = traces.map((trace) =>
      replayTrace(trace, new RerankService(), mergeChunkCandidates),
    );
    result.sources.push({ ...source, metadata, rows });
    console.log(
      `${source.id}: ${rows.length} frozen pools x ${STRATEGIES.length} strategies; exact production parity`,
    );
  }
  await fs.writeFile(
    path.join(output, 'rerank-replay.json'),
    JSON.stringify(result) + '\n',
  );
  return result;
}

if (require.main === module) {
  const [protocolFile, output] = process.argv.slice(2);
  if (!protocolFile || !output)
    throw new Error('Usage: node rerank-replay.cjs protocol.json output-dir');
  json(protocolFile)
    .then((protocol) =>
      replay(path.resolve(__dirname, '../..'), protocol, path.resolve(output)),
    )
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}

module.exports = { hash, readSource, replayTrace, replay };
