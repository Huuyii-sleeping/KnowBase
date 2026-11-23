const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const path = require('node:path');
const mongoose = require('mongoose');
const { ConfigService } = require('@nestjs/config');
const run = promisify(execFile);
const load = (name) =>
  require(path.resolve(__dirname, '../../dist/src/modules', name));
const schemas = load('ingestion/artifacts/artifact.schemas.js');
const { ChunkArtifactStore } = load(
  'ingestion/artifacts/chunk-artifact.store.js',
);
const { EmbeddingCacheStore } = load(
  'ingestion/artifacts/embedding-cache.store.js',
);
const { DocumentEmbeddingService } = load(
  'pipeline/embedding/document-embedding.service.js',
);
const { DocumentChunksService } = load(
  'pipeline/chunk/document-chunks.service.js',
);
const { MarkdownChunkerService } = load(
  'pipeline/chunk/markdown-chunker.service.js',
);
const { DocumentContentStore } = load('documents/document-content.store.js');
const { DocumentContentSchema } = load(
  'documents/schemas/document-content.schema.js',
);
const composeArgs = [
  'compose',
  '-f',
  path.resolve(
    __dirname,
    '../../../../deploy/docker-compose.ingestion-test.yml',
  ),
  '-p',
  `knowbase-ingestion-test-${process.pid}`,
];
const compose = (...args) =>
  run('docker', [...composeArgs, ...args], { timeout: 120000 });
let connection, artifacts, cache, chunkModel, cacheModel, content;
before(
  async () => {
    await compose(
      'up',
      '-d',
      '--wait',
      '--wait-timeout',
      '90',
      '--pull',
      process.env.DELIVERY_TEST_PULL_POLICY || 'missing',
    );
    const { stdout } = await compose('port', 'mongo', '27017');
    connection = await mongoose
      .createConnection(
        `mongodb://127.0.0.1:${stdout.trim().split(':').pop()}/ingestion`,
      )
      .asPromise();
    chunkModel = connection.model(
      schemas.CHUNK_ARTIFACT_MODEL,
      schemas.ChunkArtifactSchema,
    );
    cacheModel = connection.model(
      schemas.EMBEDDING_CACHE_MODEL,
      schemas.EmbeddingCacheSchema,
    );
    const contentModel = connection.model(
      'DocumentContent',
      DocumentContentSchema,
    );
    await Promise.all([
      chunkModel.init(),
      cacheModel.init(),
      contentModel.init(),
    ]);
    const config = new ConfigService();
    artifacts = new ChunkArtifactStore(chunkModel, config);
    cache = new EmbeddingCacheStore(cacheModel, config);
    content = new DocumentContentStore(contentModel);
  },
  { timeout: 120000 },
);
after(
  async () => {
    try {
      await connection?.close();
    } finally {
      await compose('down', '-v', '--remove-orphans');
    }
  },
  { timeout: 120000 },
);

test('Mongo preserves ordered chunks and locations, hides partial writes and expires reusable artifacts', async () => {
  const config = new ConfigService({
    RAG_CHUNK_SIZE: 100,
    RAG_CHUNK_OVERLAP: 10,
  });
  const source = {
    markdown: '## 发布\n\n审核通过后建立索引。',
    sections: [{ start: 0, end: 18, source: { page: 1 } }],
  };
  source.sections[0].end = source.markdown.length;
  const service = new DocumentChunksService(
    new MarkdownChunkerService(config),
    artifacts,
  );
  const chunks = await service.forContent('doc', 'body', source);
  assert.equal(chunks[0].ranges[0].source.page, 1);
  assert.deepEqual(await service.forContent('doc', 'body', source), chunks);
  const [{ key }] = await chunkModel.find({ index: -1 }).lean();
  await chunkModel.deleteOne({ key, index: -1 });
  assert.equal(await artifacts.find(key), undefined);
  await artifacts.save('doc', key, chunks);
  await chunkModel.updateMany({ key }, { $set: { expiresAt: new Date(0) } });
  assert.equal(await artifacts.find(key), undefined);
  assert.ok(
    (await chunkModel.collection.indexes()).some(
      (index) => index.expireAfterSeconds === 0,
    ),
  );
});

test('vectors survive service recreation but are isolated by document and model revision', async () => {
  let calls = 0;
  const provider = {
    fingerprint: 'model-revision1',
    dimensions: 2,
    embedDocuments: async (texts) => {
      calls++;
      return texts.map(() => [1, 2]);
    },
  };
  await new DocumentEmbeddingService(provider, cache).embed('doc', [
    'body',
    'body',
  ]);
  assert.equal(calls, 1);
  await new DocumentEmbeddingService(provider, cache).embed('doc', ['body']);
  assert.equal(calls, 1);
  await new DocumentEmbeddingService(provider, cache).embed('other', ['body']);
  provider.fingerprint = 'model-revision2';
  await new DocumentEmbeddingService(provider, cache).embed('doc', ['body']);
  assert.equal(calls, 3);
  await artifacts.deleteDocument('doc');
  await cache.deleteDocument('doc');
  assert.equal(await cacheModel.countDocuments({ documentId: 'doc' }), 0);
  assert.equal(await cacheModel.countDocuments({ documentId: 'other' }), 1);
});

test('content serialization preserves source blocks; manual edits have no inherited binary location', async () => {
  await content.create({
    contentId: 'parsed',
    documentId: 'doc',
    markdown: '正文',
    parser: 'pdf',
    warnings: [],
    assets: [],
    version: 1,
    sections: [{ start: 0, end: 2, source: { page: 2 } }],
  });
  const parsed = await content.findByContentId('parsed');
  assert.equal(parsed.blocks[0].source.page, 2);
  await content.create({
    contentId: 'manual',
    documentId: 'doc',
    markdown: '编辑后的正文',
    parser: 'manual-markdown',
    warnings: [],
    assets: [],
    version: 2,
  });
  const manual = await content.findByContentId('manual');
  assert.equal(manual.blocks[0].source, undefined);
  assert.equal(manual.sections, undefined);
  await content.deleteByDocumentId('doc');
  assert.equal(await content.findByContentId('parsed'), null);
});

test('document deletion keeps asset references until storage removal succeeds', async () => {
  const { DocumentSourceCleanupService } = load(
    'documents/document-source-cleanup.service.js',
  );
  const { DocumentAssetsCleanupService } = load(
    'documents/document-assets-cleanup.service.js',
  );
  const record = (contentId, version) => ({
    contentId,
    documentId: 'cleanup',
    version,
    markdown: 'body',
    parser: 'test',
    warnings: [],
    assets: [
      {
        type: 'image',
        objectKey: `assets/cleanup/${version}.png`,
        url: '/image',
      },
    ],
  });
  await content.create(record('cleanup-v1', 1));
  await content.create(record('cleanup-v2', 2));
  let fail = true;
  const removed = [];
  const storage = {
    removeObject: async (key) => {
      if (fail) throw new Error('storage offline');
      removed.push(key);
    },
  };
  const cleanup = new DocumentSourceCleanupService(
    content,
    storage,
    { isDeleted: async () => true },
    artifacts,
    cache,
    new DocumentAssetsCleanupService(storage),
  );
  await assert.rejects(
    cleanup.cleanup('cleanup', 'original/cleanup/file'),
    /storage offline/,
  );
  assert.ok(await content.findByContentId('cleanup-v1'));
  fail = false;
  await cleanup.cleanup('cleanup', 'original/cleanup/file');
  assert.deepEqual(removed.sort(), [
    'assets/cleanup/1.png',
    'assets/cleanup/2.png',
    'original/cleanup/file',
  ]);
  assert.equal(await content.findByContentId('cleanup-v2'), null);
});

test('manual Mongo index migration is repeatable and matches TTL requirements', async () => {
  for (let i = 0; i < 2; i++)
    await compose(
      'exec',
      '-T',
      'mongo',
      'mongosh',
      '--quiet',
      '/schema/migrations/003_ingestion_indexes.js',
    );
  const target = connection.useDb('knowbase');
  for (const name of ['ingestion_chunks', 'ingestion_embeddings']) {
    const indexes = await target.collection(name).indexes();
    assert.ok(indexes.some((index) => index.expireAfterSeconds === 0));
    assert.ok(indexes.some((index) => index.unique));
  }
});
