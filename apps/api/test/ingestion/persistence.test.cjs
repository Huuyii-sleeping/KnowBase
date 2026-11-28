const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const { promisify } = require('node:util');
const { execFile, fork } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs/promises');
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
const { EmbeddingBatcher } = load('pipeline/embedding/embedding-batcher.js');
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
let mongoUri,
  connection,
  artifacts,
  cache,
  chunkModel,
  cacheModel,
  content,
  evidence,
  evidenceModel,
  storage,
  assetModel;
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
    mongoUri = `mongodb://127.0.0.1:${stdout.trim().split(':').pop()}/ingestion`;
    connection = await mongoose.createConnection(mongoUri).asPromise();
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
    const { EVIDENCE_MODEL, EvidenceSchema } = load(
      'documents/evidence/evidence.schema.js',
    );
    const { DocumentEvidenceStore } = load(
      'documents/evidence/document-evidence.store.js',
    );
    evidenceModel = connection.model(EVIDENCE_MODEL, EvidenceSchema);
    await evidenceModel.init();
    evidence = new DocumentEvidenceStore(evidenceModel);
    content = new DocumentContentStore(contentModel, evidence);
    const { AssetRegistrySchema, ASSET_REGISTRY_MODEL } = load(
      'storage/asset-registry.schema.js',
    );
    const { StorageService } = load('storage/storage.service.js');
    assetModel = connection.model(ASSET_REGISTRY_MODEL, AssetRegistrySchema);
    await assetModel.init();
    const { stdout: storagePort } = await compose(
      'port',
      'object-storage',
      '9000',
    );
    storage = new StorageService(
      new ConfigService({
        RUSTFS_ENDPOINT: '127.0.0.1',
        RUSTFS_PORT: Number(storagePort.trim().split(':').pop()),
        RUSTFS_ACCESS_KEY: 'ingestion-test',
        RUSTFS_SECRET_KEY: 'ingestion-test-password',
        RUSTFS_BUCKET: 'evidence-test',
      }),
      assetModel,
    );
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

test('canonical table serialization, chunk provenance and deletion survive a real Mongo round trip', async () => {
  const { tableFixtures } = require('./table-fixtures.cjs');
  const fixture = tableFixtures()[0];
  const source = {
    markdown: fixture.table,
    sections: [
      {
        start: 0,
        end: fixture.table.length,
        source: { page: 4, blockIndex: 2 },
      },
    ],
  };
  await content.create({
    ...source,
    contentId: 'table-body',
    documentId: 'table-doc',
    parser: 'mineru',
    warnings: [],
    assets: [],
    version: 1,
  });
  const stored = await content.findByContentId('table-body');
  const table = stored.tables[0];
  assert.equal(table.cells.length, fixture.canonicalCells);
  assert.equal(table.cells.find((cell) => cell.text === '研发').rowSpan, 2);
  assert.equal(stored.blocks[0].table, undefined);
  assert.equal(stored.blocks[0].tableId, table.id);
  assert.deepEqual(table.source, { page: 4, blockIndex: 2 });
  const { sumTableCells } = load('ingestion/tables/table-sum.js');
  assert.equal(
    sumTableCells(table, fixture.sum.cells).value,
    fixture.sum.value,
  );
  const chunks = new DocumentChunksService(
    new MarkdownChunkerService(
      new ConfigService({ RAG_CHUNK_SIZE: 130, RAG_CHUNK_OVERLAP: 0 }),
    ),
    artifacts,
  );
  const first = await chunks.forContent('table-doc', 'table-body', stored);
  assert.deepEqual(
    await chunks.forContent('table-doc', 'table-body', stored),
    first,
  );
  assert.ok(
    first.every(
      (chunk) =>
        chunk.ranges[0].source.tableId === table.id &&
        chunk.ranges[0].source.page === 4,
    ),
  );
  await content.deleteByDocumentId('table-doc');
  await artifacts.deleteDocument('table-doc');
  assert.equal(await content.findByContentId('table-body'), null);
  assert.equal(await chunkModel.countDocuments({ documentId: 'table-doc' }), 0);
});

test('long-cell chunks preserve exact cell provenance through Mongo, reject tampered artifacts and clean failed builds', async () => {
  const documentId = 'long-cell-doc',
    contentId = 'long-cell-body';
  const value = '复检通过后才允许付款；'.repeat(35) + '退款为-2.25万元。';
  const markdown =
    '# 质量采购\n\n| 编号 | 条件 |\n| --- | --- |\n| B72 | ' + value + ' |';
  await content.create({
    markdown,
    sections: [{ start: 0, end: markdown.length, source: { page: 7 } }],
    documentId,
    contentId,
    version: 1,
    parser: 'fixture',
    warnings: [],
    assets: [],
  });
  const stored = await content.findByContentId(contentId);
  const before = JSON.stringify(stored.tables);
  const chunker = new MarkdownChunkerService(
    new ConfigService({ RAG_CHUNK_SIZE: 180, RAG_CHUNK_OVERLAP: 0 }),
  );
  const service = new DocumentChunksService(chunker, artifacts);
  const chunks = await service.forContent(documentId, contentId, stored);
  const values = chunks.filter(
    (chunk) => chunk.ranges[0].source.tableColumn === 2,
  );
  assert.ok(values.length > 1);
  assert.equal(
    values
      .map((chunk) => {
        const source = chunk.ranges[0].source;
        assert.equal(source.page, 7);
        assert.equal(source.tableRowStart, 2);
        const text = value.slice(source.tableCellStart, source.tableCellEnd);
        assert.ok(chunk.content.endsWith(text));
        return text;
      })
      .join(''),
    value,
  );
  assert.equal(JSON.stringify(stored.tables), before);
  assert.deepEqual(
    await new DocumentChunksService(chunker, artifacts).forContent(
      documentId,
      contentId,
      stored,
    ),
    chunks,
  );
  const manifest = await chunkModel.findOne({ documentId, index: -1 }).lean();
  await chunkModel.updateOne(
    { key: manifest.key, index: 0 },
    { $set: { 'chunk.ranges.0.source.tableCellStart': 999 } },
  );
  assert.equal(await artifacts.find(manifest.key), undefined);
  assert.deepEqual(
    await service.forContent(documentId, contentId, stored),
    chunks,
  );
  const broken = {
    markdown: '| ' + '超长标题'.repeat(100) + ' |\n| --- |\n| 0 |',
  };
  await assert.rejects(
    service.forContent('broken-cell-doc', 'broken-body', broken),
    /context/,
  );
  assert.equal(
    await chunkModel.countDocuments({ documentId: 'broken-cell-doc' }),
    0,
  );
  await content.deleteByDocumentId(documentId);
  await artifacts.deleteDocument(documentId);
  assert.equal(await chunkModel.countDocuments({ documentId }), 0);
  assert.equal(await content.findByContentId(contentId), null);
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
    assetKeys: async () => [],
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

test('native XLSX evidence preserves formulas, zero and merge references through Mongo and detects missing or changed records', async () => {
  const ExcelJS = require('exceljs');
  const { XlsxEvidenceExtractor } = load(
    'documents/parsing/xlsx/xlsx-evidence.extractor.js',
  );
  const workbook = new ExcelJS.Workbook();
  workbook.properties.date1904 = true;
  const sheet = workbook.addWorksheet('预算');
  sheet.addRows([
    ['分类', '值'],
    ['研发', 0],
    ['', { formula: 'B2+12', result: 12 }],
    ['日期', new Date('2026-11-23T00:00:00Z')],
  ]);
  sheet.mergeCells('A2:A3');
  const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
  const native = await new XlsxEvidenceExtractor().extract(bytes);
  const input = {
    contentId: 'xlsx-evidence',
    documentId: 'xlsx-doc',
    version: 1,
    markdown: '预算',
    parser: 'mineru',
    warnings: [],
    assets: [],
    evidence: native.evidence,
    ready: true,
  };
  await content.create(input);
  await content.verifyEvidence(input.contentId);
  await evidence.save(input.documentId, input.contentId, native.evidence);
  await content.verifyEvidence(input.contentId);
  const page = await evidence.page(input.documentId, input.contentId, 1, 2);
  assert.equal(page.length, 2);
  assert.equal(page[0].source.cellRange, 'A2:B2');
  assert.equal(page[0].data.cells[1].value, 0);
  assert.equal(page[1].data.cells[0].coveredBy, 'A2');
  assert.equal(page[1].data.cells[1].cachedResult, 12);
  assert.equal(page[1].data.date1904, true);
  const original = native.evidence[0];
  await evidenceModel.updateOne(
    { contentId: input.contentId, id: original.id },
    { $set: { text: '篡改' } },
  );
  await assert.rejects(content.verifyEvidence(input.contentId), /integrity/);
  await evidenceModel.updateOne(
    { contentId: input.contentId, id: original.id },
    { $set: { text: original.text } },
  );
  await evidenceModel.deleteOne({
    contentId: input.contentId,
    id: original.id,
  });
  await assert.rejects(content.verifyEvidence(input.contentId), /incomplete/);
  await content.deleteByContentId(input.contentId);
  assert.equal(
    await evidenceModel.countDocuments({ contentId: input.contentId }),
    0,
  );
});

test('real object storage preserves hashes and MIME, supports byte seeks, and keeps ownership after a failed write', async () => {
  const { createHash } = require('node:crypto');
  const { AssetUploaderService } = load(
    'documents/parsing/asset-uploader.service.js',
  );
  const { DocumentAssetsCleanupService } = load(
    'documents/document-assets-cleanup.service.js',
  );
  const uploader = new AssetUploaderService(
    storage,
    new DocumentAssetsCleanupService(storage),
  );
  const bytes = Buffer.from('audio/video source 0123456789');
  const asset = await uploader.upload('resource-doc', {
    fileName: 'clip.wav',
    contentType: 'audio/wav',
    data: bytes,
  });
  assert.equal(asset.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(asset.bytes, bytes.length);
  assert.equal(
    (await storage.statObject(asset.objectKey)).metaData['content-type'],
    'audio/wav',
  );
  const read = async (stream) => {
    const parts = [];
    for await (const part of stream) parts.push(part);
    return Buffer.concat(parts);
  };
  assert.deepEqual(await read(await storage.getObject(asset.objectKey)), bytes);
  assert.deepEqual(
    await read(await storage.getPartialObject(asset.objectKey, 3, 7)),
    bytes.subarray(3, 10),
  );
  await content.create({
    contentId: 'resource-body',
    documentId: 'resource-doc',
    version: 1,
    markdown: 'audio',
    parser: 'test',
    warnings: [],
    assets: [asset],
    evidence: [
      {
        schema: 'evidence-v1',
        id: 'segment-1',
        kind: 'audio_segment',
        source: { startMs: 100, endMs: 500 },
        objectKeys: [asset.objectKey],
        text: 'hello',
        producer: 'fixture',
        data: {},
      },
    ],
    ready: true,
  });
  const saved = await content.findByContentId('resource-body');
  assert.equal(saved.assets[0].sha256, asset.sha256);
  assert.equal(saved.assets[0].bytes, bytes.length);
  assert.equal(saved.assets[0].contentType, 'audio/wav');
  await content.verifyEvidence('resource-body');
  assert.deepEqual(await storage.assetKeys('resource-doc'), [asset.objectKey]);
  await storage.removeObject(asset.objectKey);
  assert.deepEqual(await storage.assetKeys('resource-doc'), []);
  await assert.rejects(storage.statObject(asset.objectKey));
  const write = storage.putObject.bind(storage);
  storage.putObject = async () => {
    throw new Error('write failed');
  };
  try {
    await assert.rejects(
      storage.putAsset({
        documentId: 'failed-resource',
        fileName: 'image.png',
        contentType: 'image/png',
        data: bytes,
      }),
      /write failed/,
    );
  } finally {
    storage.putObject = write;
  }
  const [reserved] = await storage.assetKeys('failed-resource');
  assert.ok(reserved);
  await storage.removeObject(reserved);
  assert.deepEqual(await storage.assetKeys('failed-resource'), []);
  await content.deleteByDocumentId('resource-doc');
});

test('an interrupted body write leaves independently cleanable evidence and never exposes an adopted body', async () => {
  const bodyModel = connection.model('DocumentContent');
  const brokenModel = class {
    async save() {
      throw new Error('body write failed');
    }
  };
  const broken = new DocumentContentStore(brokenModel, evidence);
  await assert.rejects(
    broken.create({
      contentId: 'broken-body',
      documentId: 'broken-doc',
      version: 1,
      markdown: 'body',
      parser: 'fixture',
      warnings: [],
      assets: [],
      evidence: [
        {
          schema: 'evidence-v1',
          id: 'image-1',
          kind: 'image',
          source: { page: 2 },
          objectKeys: [],
          text: 'test',
          producer: 'fixture',
          data: {},
        },
      ],
    }),
    /body write failed/,
  );
  assert.equal(await bodyModel.findOne({ contentId: 'broken-body' }), null);
  assert.equal(
    await evidenceModel.countDocuments({ contentId: 'broken-body' }),
    1,
  );
  await content.deleteByContentId('broken-body');
  assert.equal(
    await evidenceModel.countDocuments({ contentId: 'broken-body' }),
    0,
  );
});

test('evidence and ownership index migrations are repeatable', async () => {
  for (let i = 0; i < 2; i++)
    await compose(
      'exec',
      '-T',
      'mongo',
      'mongosh',
      '--quiet',
      '/schema/migrations/004_document_evidence.js',
    );
  const target = connection.useDb('knowbase');
  assert.equal(
    (await target.collection('document_evidence').indexes()).filter(
      (index) => index.unique,
    ).length,
    2,
  );
  assert.ok(
    (await target.collection('document_assets').indexes()).some(
      (index) => index.unique,
    ),
  );
});

test('real Mongo compares aggregate checkpoints with per-batch recovery on identical deterministic inputs', async () => {
  const texts = [
    '北区审批规则',
    '南区审批规则',
    '东区额度限制',
    '西区额度限制',
    '总部例外规则',
    '门店退款流程',
  ];
  const vector = (text) => [
    Array.from(text).reduce(
      (sum, character) => sum + character.codePointAt(0),
      0,
    ),
    1,
  ];
  async function scenario(incremental) {
    const documentId = `recovery-${incremental}`;
    const inputs = [];
    let fail = true;
    const batcher = new EmbeddingBatcher(
      {
        embedDocuments: async (batch) => {
          inputs.push(...batch);
          if (fail && batch.includes(texts[4]))
            throw new Error('injected final batch failure');
          return batch.map(vector);
        },
      },
      { dimensions: 2, batchSize: 2, maxCharacters: 100, concurrency: 1 },
    );
    // Baseline reproduces the earlier aggregate checkpoint policy by withholding the batch hook.
    const provider = {
      fingerprint: 'recovery-revision',
      dimensions: 2,
      embedDocuments: (batch, callback) =>
        batcher.embedDocuments(batch, incremental ? callback : undefined),
    };
    const service = () =>
      new DocumentEmbeddingService(
        provider,
        new EmbeddingCacheStore(cacheModel, new ConfigService()),
      );
    await assert.rejects(
      service().embed(documentId, texts),
      /injected final batch/,
    );
    const persistedAfterFailure = await cacheModel.countDocuments({
      documentId,
    });
    const failedAttemptInputs = inputs.length;
    fail = false;
    const recovered = await service().embed(documentId, texts);
    assert.deepEqual(recovered, texts.map(vector));
    const retryInputs = inputs.length - failedAttemptInputs;
    const beforeRepeat = inputs.length;
    await service().embed(documentId, texts);
    const repeatInputs = inputs.length - beforeRepeat;
    const changed = [...texts.slice(0, -1), '门店退款流程（修订版）'];
    const beforeEdit = inputs.length;
    assert.deepEqual(
      await service().embed(documentId, changed),
      changed.map(vector),
    );
    return {
      persistedAfterFailure,
      failedAttemptInputs,
      retryInputs,
      repeatInputs,
      editedInputs: inputs.length - beforeEdit,
      vectorsCorrect: true,
    };
  }
  const before = await scenario(false),
    after = await scenario(true);
  assert.deepEqual(before, {
    persistedAfterFailure: 0,
    failedAttemptInputs: 6,
    retryInputs: 6,
    repeatInputs: 0,
    editedInputs: 1,
    vectorsCorrect: true,
  });
  assert.deepEqual(after, {
    persistedAfterFailure: 4,
    failedAttemptInputs: 6,
    retryInputs: 2,
    repeatInputs: 0,
    editedInputs: 1,
    vectorsCorrect: true,
  });
  const report = {
    fixture:
      '6 synthetic business chunks; batchSize=2; concurrency=1; fail final batch',
    storage: 'real isolated MongoDB',
    model:
      'deterministic fake; counts measure model inputs, not model latency or accuracy',
    before,
    after,
    retryInputReduction:
      (before.retryInputs - after.retryInputs) / before.retryInputs,
  };
  const output = path.resolve(
    __dirname,
    '../../../../reports/ingestion-index-recovery',
  );
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(
    path.join(output, 'comparison.json'),
    JSON.stringify(report, null, 2),
  );
});

test(
  'SIGKILL after a persisted checkpoint still permits a fresh service to compute only the missing vectors',
  { timeout: 20000 },
  async () => {
    const child = fork(path.join(__dirname, 'embedding-crash-worker.cjs'), [], {
      env: { ...process.env, INGESTION_TEST_MONGO_URI: mongoUri },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    const exited = once(child, 'exit');
    const deadline = setTimeout(() => child.kill('SIGKILL'), 15000);
    try {
      const checkpoint = await Promise.race([
        once(child, 'message').then(([message]) => message),
        exited.then(() => {
          throw new Error('child exited before checkpoint');
        }),
      ]);
      assert.equal(checkpoint.checkpoint, 4);
      child.kill('SIGKILL');
      const [, signal] = await exited;
      assert.equal(signal, 'SIGKILL');
      assert.equal(
        await cacheModel.countDocuments({ documentId: 'crash-test' }),
        4,
      );
      const inputs = [];
      const batcher = new EmbeddingBatcher(
        {
          embedDocuments: async (texts) => {
            inputs.push(...texts);
            return texts.map((text) => [text.length, 1]);
          },
        },
        { dimensions: 2, batchSize: 2, maxCharacters: 100, concurrency: 1 },
      );
      const provider = {
        fingerprint: 'crash-revision',
        dimensions: 2,
        embedDocuments: (texts, callback) =>
          batcher.embedDocuments(texts, callback),
      };
      const texts = ['one', 'two', 'three', 'four', 'five', 'six'];
      const result = await new DocumentEmbeddingService(provider, cache).embed(
        'crash-test',
        texts,
      );
      assert.deepEqual(inputs, ['five', 'six']);
      assert.deepEqual(
        result,
        texts.map((text) => [text.length, 1]),
      );
    } finally {
      clearTimeout(deadline);
      child.kill('SIGKILL');
      await exited;
    }
  },
);
