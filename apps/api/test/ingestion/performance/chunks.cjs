const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { ConfigService } = require('@nestjs/config');
const { load } = require('../runtime.cjs');
const { MarkdownChunkerService } = load(
  'pipeline/chunk/markdown-chunker.service.js',
);
const { DocumentChunksService } = load(
  'pipeline/chunk/document-chunks.service.js',
);

async function benchmarkChunks(env, repeats) {
  const markdown = Array.from(
    { length: 300 },
    (_, i) =>
      `## Section ${i}\n\n` +
      `Document ${i} must be approved before indexing. Preserve source references and retry failed delivery. `.repeat(
        12,
      ) +
      '\n\n| Field | Value |\n| --- | --- |\n| State | Ready |\n',
  ).join('\n\n');
  const digest = (chunks) =>
    createHash('sha256').update(JSON.stringify(chunks)).digest('hex');
  const config = new ConfigService({
    RAG_CHUNK_SIZE: 1000,
    RAG_CHUNK_OVERLAP: 150,
  });
  const rows = [];
  for (let iteration = 0; iteration < repeats; iteration++) {
    const chunker = new MarkdownChunkerService(config);
    let computations = 0;
    const split = chunker.splitStructured.bind(chunker);
    chunker.splitStructured = (...args) => {
      computations++;
      return split(...args);
    };
    const start = performance.now();
    const a = await chunker.splitStructured(markdown);
    const b = await chunker.splitStructured(markdown);
    const before = { ms: performance.now() - start, computations };
    assert.equal(digest(a), digest(b));
    computations = 0;
    const first = performance.now();
    const c = await new DocumentChunksService(
      chunker,
      env.artifacts,
    ).forContent(`chunks-${iteration}`, 'body', { markdown });
    const coldMs = performance.now() - first;
    const second = performance.now();
    const d = await new DocumentChunksService(
      chunker,
      env.artifacts,
    ).forContent(`chunks-${iteration}`, 'body', { markdown });
    const hitMs = performance.now() - second;
    assert.equal(digest(a), digest(c));
    assert.equal(digest(c), digest(d));
    assert.equal(computations, 1);
    rows.push({
      iteration,
      chunks: a.length,
      digest: digest(a),
      before,
      after: { ms: coldMs + hitMs, coldMs, hitMs, computations },
    });
    await env.artifacts.deleteDocument(`chunks-${iteration}`);
    assert.equal(
      await env.chunkModel.countDocuments({
        documentId: `chunks-${iteration}`,
      }),
      0,
    );
  }
  return {
    characters: markdown.length,
    bytes: Buffer.byteLength(markdown),
    conditions:
      'Controlled comparison using the same current structural chunker twice without artifacts versus two sequential consumers using real MongoDB artifacts. This isolates reuse, not a Git-baseline chunker comparison. Hashing, serialization and DB IO included; equality and cleanup verified.',
    rows,
  };
}
module.exports = { benchmarkChunks };
