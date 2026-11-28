const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { load } = require('../runtime.cjs');
const { ElasticsearchSchema } = load(
  'pipeline/vector-index/elasticsearch-schema.js',
);
const { ElasticsearchGenerationWriter } = load(
  'pipeline/vector-index/elasticsearch-generation.writer.js',
);

async function benchmarkIndex(env, old, repeats) {
  const chunks = Array.from({ length: 1000 }, (_, i) => ({
    id: `chunk-${i}`,
    version: 1,
    chunkIndex: i,
    content:
      `Section ${i}: approval is required before search indexing. `.repeat(8),
    embedding: Array.from({ length: 768 }, (_, j) =>
      Number(Math.sin((i + 1) * (j + 1)).toFixed(6)),
    ),
  }));
  const rows = [];
  for (let iteration = -1; iteration < repeats; iteration++) {
    for (const engine of iteration % 2
      ? ['after', 'before']
      : ['before', 'after']) {
      const index = `perf-${iteration < 0 ? 'warmup' : iteration}-${engine}`;
      const metrics = {
        requests: 0,
        maxPayloadBytes: 0,
        totalPayloadBytes: 0,
        maxBatchChunks: 0,
        explicitRefreshes: 0,
      };
      const client = {
        bulk: async (request) => {
          const bytes = request.operations.reduce(
            (sum, op) => sum + Buffer.byteLength(JSON.stringify(op)) + 1,
            0,
          );
          metrics.requests++;
          metrics.totalPayloadBytes += bytes;
          metrics.maxPayloadBytes = Math.max(metrics.maxPayloadBytes, bytes);
          metrics.maxBatchChunks = Math.max(
            metrics.maxBatchChunks,
            request.operations.length / 2,
          );
          metrics.bulkRefreshMode = request.refresh;
          return env.es.bulk(request);
        },
        indices: {
          refresh: async (request) => {
            metrics.explicitRefreshes++;
            return env.es.indices.refresh(request);
          },
        },
      };
      const schema = new ElasticsearchSchema(
        env.es,
        `${index}-docs`,
        index,
        768,
      );
      await schema.chunks(); // Exclude initial index creation in both engines.
      const Writer =
        engine === 'before'
          ? old.GenerationWriter
          : ElasticsearchGenerationWriter;
      try {
        const start = performance.now();
        await new Writer(client, `${index}-docs`, index, schema).stageChunks(
          'doc',
          'generation',
          chunks,
        );
        metrics.ms = performance.now() - start;
        const visible = (await env.es.count({ index })).count;
        assert.equal(
          visible,
          1000,
          'stage returned before all chunks became searchable',
        );
        if (engine === 'after') {
          assert.ok(metrics.maxBatchChunks <= 200);
          assert.ok(metrics.maxPayloadBytes <= 5242880);
          assert.equal(metrics.explicitRefreshes, 1);
        }
        if (iteration >= 0)
          rows.push({ iteration, engine, visible, ...metrics });
      } finally {
        await env.es.indices.delete({ index });
      }
    }
  }
  return {
    chunks: 1000,
    dimensions: 768,
    conditions:
      'Real Elasticsearch dense_vector/HNSW writes, deterministic nonzero synthetic vectors (no model inference), same current schema for both actual baseline/current writers. Index creation excluded; mapping verification, final refresh and visibility included. One warmup pair then alternating order. Payload is serialized NDJSON before HTTP compression, not process peak RSS.',
    rows,
  };
}
module.exports = { benchmarkIndex };
