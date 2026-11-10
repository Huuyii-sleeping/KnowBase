const assert = require('node:assert/strict');
const { before, after, beforeEach, test } = require('node:test');
const { randomUUID } = require('node:crypto');
const { ConfigService } = require('@nestjs/config');
const { DeliveryTestEnvironment } = require('../delivery/environment.cjs');
const { load } = require('../delivery/runtime.cjs');
const { IndexGenerationStore } = load('indexing/index-generation.store.js');
const { IndexBuildService } = load('indexing/index-build.service.js');
const { VectorIndexService } = load(
  'pipeline/vector-index/vector-index.service.js',
);
const { GraphIndexService } = load('pipeline/kg/graph-index.service.js');
const { DocumentRevisionService } = load(
  'documents/document-revision.service.js',
);
const { DocumentPublishService } = load(
  'documents/document-publish.service.js',
);
const { DocumentWorkflowService } = load(
  'documents/document-workflow.service.js',
);
const { DocumentPipelinePublisher } = load(
  'documents/document-pipeline.publisher.js',
);
const { DocumentDeletionService } = load(
  'documents/document-deletion.service.js',
);
const { DocumentAccessService } = load(
  'authorization/document-access.service.js',
);
const { Document } = load('documents/entities/document.entity.js');

const env = new DeliveryTestEnvironment();
env.composeFiles.push('docker-compose.index-test.yml');
let heads, builds, vector, graph, revisions, deletion, workflow;
const admin = { id: 'admin', role: 'ADMIN' };

before(
  async () => {
    await env.start();
    const esPort = (await env.compose('port', 'elasticsearch', '9200'))
      .split(':')
      .pop();
    const graphPort = (await env.compose('port', 'neo4j', '7687'))
      .split(':')
      .pop();
    const config = new ConfigService({
      ELASTICSEARCH_NODE: `http://127.0.0.1:${esPort}`,
      ELASTICSEARCH_DOCUMENT_INDEX: 'test_document',
      ELASTICSEARCH_CHUNK_INDEX: 'test_chunk',
      RAG_EMBEDDING_DIMENSIONS: 2,
      NEO4J_URI: `bolt://127.0.0.1:${graphPort}`,
      NEO4J_USER: 'neo4j',
      NEO4J_PASSWORD: 'index-test-password',
    });
    heads = new IndexGenerationStore(env.source);
    builds = new IndexBuildService(heads);
    vector = new VectorIndexService(config, heads);
    graph = new GraphIndexService(config, heads);
    const access = new DocumentAccessService(
      env.source.getRepository(Document),
    );
    const content = {
      findByContentId: async () => ({ markdown: '# Fixture' }),
    };
    const publisher = new DocumentPipelinePublisher(
      env.runtime().outbox,
      content,
    );
    revisions = new DocumentRevisionService(env.source, content, access);
    deletion = new DocumentDeletionService(
      env.source,
      access,
      heads,
      publisher,
    );
    workflow = new DocumentWorkflowService(
      env.source,
      new DocumentPublishService(env.source, publisher, access),
      access,
    );
  },
  { timeout: 120000 },
);

after(
  async () => {
    try {
      await vector?.onModuleDestroy();
      await graph?.onModuleDestroy();
    } finally {
      await env.close();
    }
  },
  { timeout: 120000 },
);

beforeEach(async () => {
  // Keep the infrastructure runtime alive; reset only this isolated database's state.
  await env.source.query(
    'TRUNCATE kh_index_head, kh_document, kh_pipeline_outbox, kh_pipeline_receipt',
  );
});

async function document() {
  const id = randomUUID();
  await env.source.query(
    `INSERT INTO kh_document
    (id, title, file_name, mime_type, storage_key, content_id, uploader_id, status, parse_status)
    VALUES ($1, 'Original', 'fixture.md', 'text/markdown', $2, $3, 'admin', 'PUBLISHED', 'READY')`,
    [id, `original/${id}/fixture.md`, randomUUID()],
  );
  return heads.capture(id, 1);
}

function gate() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function stage(pipeline, document, generation, label) {
  if (pipeline === 'search') {
    await vector.indexDocument({
      id: document.id,
      generation,
      document: {
        id: document.id,
        title: label,
        content: label,
        status: 'PUBLISHED',
        version: document.version,
        updatedAt: new Date().toISOString(),
      },
    });
  } else if (pipeline === 'rag') {
    await vector.stageChunks(
      document.id,
      generation,
      [0, 1].map((index) => ({
        id: `${document.id}:v${document.version}:c${index}`,
        documentId: document.id,
        version: document.version,
        chunkIndex: index,
        content: label,
        embedding: [1, 0],
      })),
    );
  } else {
    const chunkId = `${document.id}:${generation}:c0`;
    const seed = `seed:${document.id}`,
      target = `target:${document.id}`;
    await graph.stageDocument(
      document.id,
      document.version,
      generation,
      [
        {
          id: chunkId,
          documentId: document.id,
          version: document.version,
          chunkIndex: 0,
          content: label,
        },
      ],
      [
        { key: seed, name: document.id, type: 'Seed' },
        { key: target, name: 'Target', type: 'Target' },
      ],
      [
        { chunkId, entityKey: seed },
        { chunkId, entityKey: target },
      ],
      [
        {
          key: `${generation}:rel`,
          sourceKey: seed,
          targetKey: target,
          type: label,
          chunkId,
        },
      ],
    );
  }
}

function discard(pipeline, id, generation) {
  return pipeline === 'kg'
    ? graph.discardGeneration(id, generation)
    : vector.discardGeneration(pipeline, generation);
}

async function visible(pipeline, id) {
  if (pipeline === 'search') {
    return (
      await vector.searchDocuments({
        page: 1,
        pageSize: 20,
        allowedDocumentIds: [id],
      })
    ).items.map((item) => item.title);
  }
  if (pipeline === 'rag') {
    return (
      await vector.searchChunks({
        queryVector: [1, 0],
        topK: 10,
        allowedDocumentIds: [id],
      })
    ).map((item) => item.content);
  }
  return (
    await graph.searchRelated({
      query: id,
      allowedDocumentIds: [id],
      maxHops: 2,
      limit: 20,
    })
  ).flatMap((item) => item.relations.map((relation) => relation.type));
}

async function build(pipeline, document, label) {
  return builds.build(
    document,
    pipeline,
    (generation) => stage(pipeline, document, generation, label),
    (generation) => discard(pipeline, document.id, generation),
  );
}

for (const pipeline of ['search', 'rag', 'kg']) {
  test(
    `${pipeline}: a late old build cannot replace a newer published version`,
    { timeout: 30000 },
    async () => {
      const old = await document();
      assert.equal(await build(pipeline, old, 'Original'), true);
      const staged = gate(),
        release = gate();
      const late = builds.build(
        old,
        pipeline,
        async (generation) => {
          await stage(pipeline, old, generation, 'Obsolete');
          staged.resolve();
          await release.promise;
        },
        (generation) => discard(pipeline, old.id, generation),
      );
      try {
        await staged.promise;
        await revisions.updateMetadata(old.id, { title: 'New' }, admin);
        assert.deepEqual(
          await visible(pipeline, old.id),
          [],
          'draft revisions do not expose the previous published index',
        );
        await workflow.submitForReview(old.id, admin);
        await workflow.review(old.id, { approved: true }, admin);
        const current = await heads.capture(old.id, 2);
        assert.ok(current);
        assert.equal(await build(pipeline, current, 'New'), true);
      } finally {
        release.resolve();
      }
      assert.equal(await late, false);
      const results = await visible(pipeline, old.id);
      assert.ok(results.length > 0);
      assert.ok(results.every((value) => value === 'New'));
    },
  );

  test(
    `${pipeline}: staged or partially failed rebuilds never disturb the active batch`,
    { timeout: 30000 },
    async () => {
      const current = await document();
      await build(pipeline, current, 'Original');
      const started = gate(),
        release = gate();
      const failed = builds.build(
        current,
        pipeline,
        async (generation) => {
          await stage(pipeline, current, generation, 'Incomplete');
          started.resolve();
          await release.promise;
          throw new Error('injected build failure');
        },
        (generation) => discard(pipeline, current.id, generation),
      );
      const failure = assert.rejects(failed, /build failure/);
      try {
        await started.promise;
        assert.ok(
          (await visible(pipeline, current.id)).every(
            (value) => value === 'Original',
          ),
        );
      } finally {
        release.resolve();
      }
      await failure;
      const results = await visible(pipeline, current.id);
      assert.ok(results.length > 0);
      assert.ok(results.every((value) => value === 'Original'));
    },
  );

  test(
    `${pipeline}: a deleted document cannot be resurrected by a paused rebuild`,
    { timeout: 30000 },
    async () => {
      const current = await document();
      await build(pipeline, current, 'Original');
      const started = gate(),
        release = gate();
      const late = builds.build(
        current,
        pipeline,
        async (generation) => {
          started.resolve();
          await release.promise;
          await stage(pipeline, current, generation, 'Resurrected');
        },
        (generation) => discard(pipeline, current.id, generation),
      );
      try {
        await started.promise;
        await deletion.remove(current.id, admin);
        assert.equal(
          (
            await env.source.query(
              'SELECT * FROM kh_index_head WHERE document_id = $1 AND deleted',
              [current.id],
            )
          ).length,
          3,
        );
        assert.equal(
          (await env.source.query('SELECT * FROM kh_pipeline_outbox')).length,
          4,
        );
        await vector.deleteDocument(current.id, 'search');
        await vector.deleteDocument(current.id, 'rag');
        await graph.deleteDocument(current.id);
      } finally {
        release.resolve();
      }
      assert.equal(await late, false);
      assert.deepEqual(await visible(pipeline, current.id), []);
      assert.equal(await heads.capture(current.id, current.version), null);
    },
  );
}

test('deletion task insertion failure rolls back metadata deletion and all tombstones', async () => {
  const current = await document();
  await build('rag', current, 'Original');
  const access = new DocumentAccessService(env.source.getRepository(Document));
  const failing = new DocumentDeletionService(env.source, access, heads, {
    deleteDocument: async (_document, manager) => {
      await env.runtime().outbox.enqueue(manager, 'document.search.delete', {
        documentId: current.id,
      });
      throw new Error('injected deletion outbox failure');
    },
  });
  await assert.rejects(failing.remove(current.id, admin), /outbox failure/);
  assert.ok(await heads.capture(current.id, 1));
  assert.equal(
    (await env.source.query('SELECT * FROM kh_index_head WHERE deleted'))
      .length,
    0,
  );
  assert.equal(
    (await env.source.query('SELECT * FROM kh_pipeline_outbox')).length,
    0,
  );
  assert.ok(
    (await visible('rag', current.id)).every((value) => value === 'Original'),
  );
});

test('a real Elasticsearch partial bulk failure cannot expose an incomplete vector batch', async () => {
  const current = await document();
  await build('rag', current, 'Original');
  await assert.rejects(
    builds.build(
      current,
      'rag',
      (generation) =>
        vector.stageChunks(current.id, generation, [
          {
            id: `${current.id}:good`,
            documentId: current.id,
            version: 1,
            chunkIndex: 0,
            content: 'Incomplete',
            embedding: [1, 0],
          },
          {
            id: `${current.id}:bad`,
            documentId: current.id,
            version: 1,
            chunkIndex: 1,
            content: 'Invalid',
            embedding: [1, 0, 0],
          },
        ]),
      (generation) => vector.discardGeneration('rag', generation),
    ),
    /one or more chunks/,
  );
  const results = await visible('rag', current.id);
  assert.equal(results.length, 2);
  assert.ok(results.every((value) => value === 'Original'));
});

test('an empty complete vector batch replaces the visible head without exposing old chunks', async () => {
  const current = await document();
  await build('rag', current, 'Original');
  assert.equal(
    await builds.build(
      current,
      'rag',
      (generation) => vector.stageChunks(current.id, generation, []),
      (generation) => vector.discardGeneration('rag', generation),
    ),
    true,
  );
  assert.deepEqual(await visible('rag', current.id), []);
});

test('concurrent metadata revisions serialize and preserve both changes with distinct revisions', async () => {
  const current = await document();
  await Promise.all([
    revisions.updateMetadata(current.id, { title: 'New title' }, admin),
    revisions.updateMetadata(current.id, { category: 'New category' }, admin),
  ]);
  const result = await env.source
    .getRepository(Document)
    .findOneBy({ id: current.id });
  assert.equal(result.version, 3);
  assert.equal(result.title, 'New title');
  assert.equal(result.category, 'New category');
  assert.equal(result.status, 'DRAFT');
});
