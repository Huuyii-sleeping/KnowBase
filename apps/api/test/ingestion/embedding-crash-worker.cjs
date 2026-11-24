// Disposable integration child: stop immediately after a durable batch checkpoint.
const path = require('node:path');
const mongoose = require('mongoose');
const { ConfigService } = require('@nestjs/config');
const load = (name) =>
  require(path.resolve(__dirname, '../../dist/src/modules', name));
(async () => {
  const connection = await mongoose
    .createConnection(process.env.INGESTION_TEST_MONGO_URI)
    .asPromise();
  const schema = load('ingestion/artifacts/artifact.schemas.js');
  const { EmbeddingCacheStore } = load(
    'ingestion/artifacts/embedding-cache.store.js',
  );
  const { DocumentEmbeddingService } = load(
    'pipeline/embedding/document-embedding.service.js',
  );
  const { EmbeddingBatcher } = load('pipeline/embedding/embedding-batcher.js');
  const model = connection.model(
    schema.EMBEDDING_CACHE_MODEL,
    schema.EmbeddingCacheSchema,
  );
  await model.init();
  const batcher = new EmbeddingBatcher(
    { embedDocuments: async (texts) => texts.map((text) => [text.length, 1]) },
    { dimensions: 2, batchSize: 2, maxCharacters: 100, concurrency: 1 },
  );
  const provider = {
    fingerprint: 'crash-revision',
    dimensions: 2,
    embedDocuments: (texts, callback) =>
      batcher.embedDocuments(texts, callback),
  };
  const service = new DocumentEmbeddingService(
    provider,
    new EmbeddingCacheStore(model, new ConfigService()),
  );
  await service.embed(
    'crash-test',
    ['one', 'two', 'three', 'four', 'five', 'six'],
    async (completed) => {
      if (completed === 4) {
        process.send({ checkpoint: completed });
        await new Promise(() => {}); // Parent deliberately SIGKILLs this process here.
      }
    },
  );
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
