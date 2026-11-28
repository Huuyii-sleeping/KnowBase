const assert = require('node:assert/strict');
const { Client } = require('@elastic/elasticsearch');
const { ConfigService } = require('@nestjs/config');
const { load } = require('../runtime.cjs');
async function deliveryIndex(port) {
  const client = new Client({ node: `http://127.0.0.1:${port}` });
  const config = new ConfigService({
    EMBEDDING_PROVIDER: 'ollama',
    OLLAMA_BASE_URL: 'http://127.0.0.1:11434',
    OLLAMA_EMBEDDING_MODEL: 'nomic-embed-text:latest',
    EMBEDDING_MODEL_REVISION: process.env.QUALITY_EMBEDDING_REVISION,
    RAG_EMBEDDING_DIMENSIONS: 768,
    RAG_EMBEDDING_CONCURRENCY: 1,
    RAG_EMBEDDING_BATCH_SIZE: 8,
    RAG_CHUNK_SIZE: 1000,
    RAG_CHUNK_OVERLAP: 150,
  });
  if (!process.env.QUALITY_EMBEDDING_REVISION)
    throw new Error('Fixed real embedding revision required');
  const embedding = new (load(
    'pipeline/embedding/embedding.service.js',
  ).EmbeddingService)(config);
  const chunker = new (load(
    'pipeline/chunk/markdown-chunker.service.js',
  ).MarkdownChunkerService)(config);
  const schema = new (load(
    'pipeline/vector-index/elasticsearch-schema.js',
  ).ElasticsearchSchema)(client, 'quality_documents', 'quality_chunks', 768);
  const writer = new (load(
    'pipeline/vector-index/elasticsearch-generation.writer.js',
  ).ElasticsearchGenerationWriter)(
    client,
    'quality_documents',
    'quality_chunks',
    schema,
  );
  return {
    client,
    chunker,
    async stage(documentId, result, generation) {
      const chunks = await chunker.splitStructured(
        result.markdown,
        result.sections,
      );
      const vectors = await embedding.embedDocuments(
        chunks.map((x) => x.embeddingText),
      );
      const inputs = chunks.map((x, i) => ({
        id: `${documentId}:v1:c${i}`,
        documentId,
        version: 1,
        chunkIndex: i,
        content: x.content,
        embedding: vectors[i],
        metadata: {
          strategy: x.strategy,
          contentHash: x.contentHash,
          headingPath: x.headingPath,
          ranges: x.ranges,
          parseStrategy: result.parseStrategy,
          embeddingFingerprint: embedding.fingerprint,
        },
      }));
      await writer.stageChunks(documentId, generation, inputs);
      const hits = await client.search({
        index: 'quality_chunks',
        size: 10000,
        query: { term: { generation_id: generation } },
        sort: [{ chunk_index: 'asc' }],
      });
      assert.equal(hits.hits.hits.length, inputs.length);
      for (const [i, hit] of hits.hits.hits.entries()) {
        assert.equal(hit._source.content, inputs[i].content);
        assert.deepEqual(hit._source.ingestion, inputs[i].metadata);
        assert.deepEqual(hit._source.embedding, vectors[i]);
      }
      return {
        chunks,
        vectors: vectors.length,
        strategy: chunker.strategy,
        embeddingFingerprint: embedding.fingerprint,
      };
    },
    async cleanup(generation) {
      await writer.discardGeneration('rag', generation);
      if (await client.indices.exists({ index: 'quality_chunks' }))
        assert.equal(
          (
            await client.count({
              index: 'quality_chunks',
              query: { term: { generation_id: generation } },
            })
          ).count,
          0,
        );
    },
  };
}
module.exports = { deliveryIndex };
