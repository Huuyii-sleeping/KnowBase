const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { ConfigService } = require('@nestjs/config');
const { load } = require('../runtime.cjs');
const { EmbeddingService } = load('pipeline/embedding/embedding.service.js');
const { DocumentEmbeddingService } = load(
  'pipeline/embedding/document-embedding.service.js',
);

// Observe real SDK traffic without storing document bodies or model output.
function observeEmbeddings(endpoint) {
  const original = globalThis.fetch;
  let current;
  globalThis.fetch = async (input, init) => {
    const url = new URL(
      typeof input === 'string' ? input : input.url || input.href,
    );
    if (
      !current ||
      url.origin !== new URL(endpoint).origin ||
      url.pathname !== '/api/embed'
    )
      return original(input, init);
    const stats = current;
    const body = JSON.parse(init?.body || (await input.clone().text()));
    const texts = Array.isArray(body.input) ? body.input : [body.input];
    stats.requests++;
    stats.inputs += texts.length;
    stats.characters += texts.reduce((sum, text) => sum + text.length, 0);
    stats.maxBatchInputs = Math.max(stats.maxBatchInputs, texts.length);
    stats.running++;
    stats.maxConcurrent = Math.max(stats.maxConcurrent, stats.running);
    try {
      const response = await original(input, init);
      // Include body consumption so concurrency covers the full response.
      await response.clone().arrayBuffer();
      return response;
    } finally {
      stats.running--;
    }
  };
  return {
    async measure(work) {
      current = {
        requests: 0,
        inputs: 0,
        characters: 0,
        maxBatchInputs: 0,
        maxConcurrent: 0,
        running: 0,
      };
      const stats = current;
      const start = performance.now();
      try {
        const result = await work();
        return { result, metrics: { ...stats, ms: performance.now() - start } };
      } finally {
        current = undefined;
      }
    },
    restore() {
      globalThis.fetch = original;
    },
  };
}

function verify(vectors, reference, texts) {
  assert.equal(vectors.length, texts.length);
  let maxAbsoluteDifference = 0;
  vectors.forEach((vector, i) => {
    assert.equal(vector.length, 768);
    let dot = 0,
      a = 0,
      b = 0;
    vector.forEach((value, j) => {
      assert.ok(Number.isFinite(value));
      const expected = reference[i][j];
      maxAbsoluteDifference = Math.max(
        maxAbsoluteDifference,
        Math.abs(value - expected),
      );
      dot += value * expected;
      a += value * value;
      b += expected * expected;
    });
    assert.ok(dot / Math.sqrt(a * b) > 0.99999, 'vector order/content changed');
    const first = texts.indexOf(texts[i]);
    assert.deepEqual(
      vector,
      vectors[first],
      'duplicate input order was not restored',
    );
  });
  return maxAbsoluteDifference;
}

async function benchmarkEmbeddings(env, old, config, observer, repeats) {
  const unique = Array.from(
    { length: 48 },
    (_, i) =>
      `Section ${i}: release ${100 + i} requires document approval before building the search index. ` +
      `The owner of record ${5000 + i} must verify the payment schedule and preserve the source page. `.repeat(
        3,
      ),
  );
  const texts = [...unique, ...unique];
  const changed = texts.map((text, i) =>
    i % 48 === 0 ? `${text} Updated retention is thirty days.` : text,
  );
  // Model-load time is deliberately outside every measured scenario.
  await old.embedding.embedDocuments(['Prewarm ingestion performance model.']);
  const rows = [];
  for (let iteration = 0; iteration < repeats; iteration++) {
    const documentId = `embedding-${iteration}`;
    const make = (revision = config.EMBEDDING_MODEL_REVISION) =>
      new DocumentEmbeddingService(
        new EmbeddingService(
          new ConfigService({ ...config, EMBEDDING_MODEL_REVISION: revision }),
        ),
        env.cache,
      );
    const scenarios = [
      { name: 'cold', texts, doc: documentId, expected: 48 },
      { name: 'unchanged-rebuild', texts, doc: documentId, expected: 0 },
      {
        name: 'one-unique-input-changed',
        texts: changed,
        doc: documentId,
        expected: 1,
      },
      {
        name: 'fingerprint-invalidated',
        texts,
        doc: documentId,
        expected: 48,
        revision: `${config.EMBEDDING_MODEL_REVISION}:invalidation-check`,
      },
      {
        name: 'different-document',
        texts,
        doc: `${documentId}-other`,
        expected: 48,
      },
    ];
    for (const scenario of scenarios) {
      const measured = {};
      // Alternate order, while keeping each document's scenario sequence.
      for (const engine of iteration % 2
        ? ['after', 'before']
        : ['before', 'after']) {
        measured[engine] = await observer.measure(() =>
          engine === 'before'
            ? old.embedding.embedDocuments(scenario.texts)
            : make(scenario.revision).embed(scenario.doc, scenario.texts),
        );
      }
      const { before, after } = measured;
      assert.equal(
        before.metrics.inputs,
        96,
        'baseline HTTP instrumentation failed',
      );
      assert.equal(after.metrics.inputs, scenario.expected);
      assert.ok(
        after.metrics.maxBatchInputs <= config.RAG_EMBEDDING_BATCH_SIZE,
      );
      assert.ok(
        after.metrics.maxConcurrent <= config.RAG_EMBEDDING_CONCURRENCY,
      );
      rows.push({
        scenario: scenario.name,
        iteration,
        before: before.metrics,
        after: after.metrics,
        maxAbsoluteVectorDifference: verify(
          after.result,
          before.result,
          scenario.texts,
        ),
      });
    }
    await env.cache.deleteDocument(documentId);
    assert.equal(await env.cacheModel.countDocuments({ documentId }), 0);
    assert.equal(
      await env.cacheModel.countDocuments({
        documentId: `${documentId}-other`,
      }),
      48,
    );
    await env.cache.deleteDocument(`${documentId}-other`);
  }
  return {
    fixture: {
      inputs: 96,
      uniqueInputs: 48,
      characters: texts.reduce((sum, text) => sum + text.length, 0),
      dimensions: 768,
    },
    conditions:
      'Real Ollama and MongoDB; model warmed once; repeated corpus may also benefit from Ollama internal caching. Service instances recreated for each scenario. Invalidation changes the application fingerprint, not physical model weights. Timings include cache IO and instrumentation body-copy overhead. No output vectors/text stored.',
    deletionVerified: true,
    rows,
  };
}
module.exports = { observeEmbeddings, benchmarkEmbeddings };
