const { UpgradeScanStore } = require('../delivery/runtime.cjs').load(
  'pipeline/upgrades/upgrade-scan.store.js',
);
const { UpgradeDispatchStore } = require('../delivery/runtime.cjs').load(
  'pipeline/upgrades/upgrade-dispatch.store.js',
);
const assert = require('node:assert/strict');
const { before, after, beforeEach, test } = require('node:test');
const { randomUUID } = require('node:crypto');
const { ConfigService } = require('@nestjs/config');
const mongoose = require('mongoose');
const {
  DeliveryTestEnvironment,
  eventually,
} = require('../delivery/environment.cjs');
const {
  load,
  MESSAGE_QUEUE_NAMES,
  MESSAGE_ROUTING_KEYS,
} = require('../delivery/runtime.cjs');
const get = (path, name) => load(path)[name];
const Document = get('documents/entities/document.entity.js', 'Document');
const IndexGenerationStore = get(
  'indexing/index-generation.store.js',
  'IndexGenerationStore',
);
const IndexBuildService = get(
  'indexing/index-build.service.js',
  'IndexBuildService',
);
const IndexBuildProgressStore = get(
  'indexing/index-build-progress.store.js',
  'IndexBuildProgressStore',
);
const GenerationRetentionStore = get(
  'indexing/generation-retention.store.js',
  'GenerationRetentionStore',
);
const VectorIndexService = get(
  'pipeline/vector-index/vector-index.service.js',
  'VectorIndexService',
);
const GraphIndexService = get(
  'pipeline/kg/graph-index.service.js',
  'GraphIndexService',
);
const UpgradePlanStore = get(
  'pipeline/upgrades/upgrade-plan.store.js',
  'UpgradePlanStore',
);
const UpgradePolicyService = get(
  'pipeline/upgrades/upgrade-policy.service.js',
  'UpgradePolicyService',
);
const UpgradePreviewService = get(
  'pipeline/upgrades/upgrade-preview.service.js',
  'UpgradePreviewService',
);
const UpgradeCommandService = get(
  'pipeline/upgrades/upgrade-command.service.js',
  'UpgradeCommandService',
);
const UpgradeSchedulerService = get(
  'pipeline/upgrades/upgrade-scheduler.service.js',
  'UpgradeSchedulerService',
);
const UpgradeExecutionStore = get(
  'pipeline/upgrades/upgrade-execution.store.js',
  'UpgradeExecutionStore',
);
const UpgradeRunnerService = get(
  'pipeline/upgrades/upgrade-runner.service.js',
  'UpgradeRunnerService',
);
const MarkdownChunkerService = get(
  'pipeline/chunk/markdown-chunker.service.js',
  'MarkdownChunkerService',
);
const DocumentChunksService = get(
  'pipeline/chunk/document-chunks.service.js',
  'DocumentChunksService',
);
const DocumentEmbeddingService = get(
  'pipeline/embedding/document-embedding.service.js',
  'DocumentEmbeddingService',
);
const GraphExtractionService = get(
  'pipeline/kg/graph-extraction.service.js',
  'GraphExtractionService',
);
const RagPipelineService = get(
  'pipeline/rag/rag-pipeline.service.js',
  'RagPipelineService',
);
const KgPipelineService = get(
  'pipeline/kg/kg-pipeline.service.js',
  'KgPipelineService',
);
const SearchPipelineService = get(
  'pipeline/search/search-pipeline.service.js',
  'SearchPipelineService',
);
const DocumentContentStore = get(
  'documents/document-content.store.js',
  'DocumentContentStore',
);
const env = new DeliveryTestEnvironment();
env.composeFiles.push(
  'docker-compose.index-test.yml',
  'docker-compose.upgrade-test.yml',
);
let config,
  connection,
  content,
  plans,
  policy,
  preview,
  commands,
  scheduler,
  executions,
  runner,
  heads,
  vector,
  graph,
  chunks,
  cache,
  runtime;
let modelInputs, graphInputs, failGraph, graphGate;
before(
  async () => {
    await env.start();
    const port = async (service, port) =>
      (await env.compose('port', service, port)).split(':').pop();
    connection = await mongoose
      .createConnection(
        `mongodb://127.0.0.1:${await port('mongo', '27017')}/upgrade_test`,
      )
      .asPromise();
    config = new ConfigService({
      ELASTICSEARCH_NODE: `http://127.0.0.1:${await port('elasticsearch', '9200')}`,
      ELASTICSEARCH_DOCUMENT_INDEX: 'upgrade_document',
      ELASTICSEARCH_CHUNK_INDEX: 'upgrade_chunk',
      RAG_EMBEDDING_DIMENSIONS: 2,
      RAG_CHUNK_SIZE: 160,
      RAG_CHUNK_OVERLAP: 20,
      NEO4J_URI: `bolt://127.0.0.1:${await port('neo4j', '7687')}`,
      NEO4J_PASSWORD: 'index-test-password',
      INDEX_UPGRADE_MAX_IN_FLIGHT: 2,
    });
    heads = new IndexGenerationStore(
      env.source,
      new GenerationRetentionStore(env.source),
    );
    const builds = new IndexBuildService(
      heads,
      new IndexBuildProgressStore(env.source),
    );
    vector = new VectorIndexService(config, heads);
    graph = new GraphIndexService(config, heads);
    const schemas = load('ingestion/artifacts/artifact.schemas.js');
    const chunkModel = connection.model(
      schemas.CHUNK_ARTIFACT_MODEL,
      schemas.ChunkArtifactSchema,
    );
    const cacheModel = connection.model(
      schemas.EMBEDDING_CACHE_MODEL,
      schemas.EmbeddingCacheSchema,
    );
    await Promise.all([chunkModel.init(), cacheModel.init()]);
    const ChunkArtifactStore = get(
      'ingestion/artifacts/chunk-artifact.store.js',
      'ChunkArtifactStore',
    );
    const EmbeddingCacheStore = get(
      'ingestion/artifacts/embedding-cache.store.js',
      'EmbeddingCacheStore',
    );
    const contentSchema = load('documents/schemas/document-content.schema.js');
    const contentModel = connection.model(
      contentSchema.DocumentContent.name,
      contentSchema.DocumentContentSchema,
    );
    content = new DocumentContentStore(contentModel);
    const chunker = new MarkdownChunkerService(config);
    chunks = new DocumentChunksService(
      chunker,
      new ChunkArtifactStore(chunkModel, config),
    );
    cache = new EmbeddingCacheStore(cacheModel, config);
    const provider = {
      fingerprint: 'deterministic-embedding-v1',
      dimensions: 2,
      validateInputs() {},
      async embedDocuments(texts) {
        modelInputs += texts.length;
        return texts.map(() => [1, 0]);
      },
    };
    const embedding = new DocumentEmbeddingService(provider, cache);
    policy = new UpgradePolicyService(config, chunker, provider, {
      fingerprint: 'deterministic-graph-v1',
    });
    plans = new UpgradePlanStore(env.source);
    preview = new UpgradePreviewService(
      new UpgradeScanStore(env.source),
      content,
      plans,
      policy,
    );
    commands = new UpgradeCommandService(env.source, policy);
    executions = new UpgradeExecutionStore(env.source);
    const extract = new GraphExtractionService({
      async extract() {
        graphInputs++;
        if (graphGate) await graphGate;
        if (failGraph) throw new Error('private-provider-response');
        return {
          entities: [
            { name: '海岚制造', type: '组织' },
            { name: '供应商', type: '组织' },
          ],
          relations: [{ source: '海岚制造', target: '供应商', type: '采购' }],
        };
      },
    });
    runner = new UpgradeRunnerService(
      executions,
      policy,
      heads,
      content,
      new SearchPipelineService(vector, heads, builds),
      new RagPipelineService(content, chunks, embedding, vector, heads, builds),
      new KgPipelineService(content, chunks, extract, graph, heads, builds),
    );
  },
  { timeout: 120000 },
);
after(
  async () => {
    try {
      await vector?.onModuleDestroy();
      await graph?.onModuleDestroy();
      await connection?.close();
    } finally {
      await env.close();
    }
  },
  { timeout: 120000 },
);
beforeEach(async () => {
  await env.reset();
  for (const collection of Object.values(connection.collections))
    await collection.deleteMany({});
  runtime = env.runtime({ retryMs: 50 });
  scheduler = new UpgradeSchedulerService(
    new UpgradeDispatchStore(env.source, runtime.outbox),
    policy,
    config,
  );
  modelInputs = 0;
  graphInputs = 0;
  failGraph = false;
  graphGate = null;
});
async function document({
  status = 'PUBLISHED',
  missing = false,
  empty = false,
  body,
} = {}) {
  const id = randomUUID(),
    contentId = randomUUID();
  await env.source.query(
    `INSERT INTO kh_document(id,title,file_name,mime_type,storage_key,content_id,uploader_id,status,parse_status)
    VALUES($1,'海岚制造采购与交付规则','rules.md','text/markdown',$2,$3,'admin',$4,'READY')`,
    [id, `original/${id}`, contentId, status],
  );
  if (!missing)
    await content.create({
      documentId: id,
      contentId,
      version: 1,
      parser: 'synthetic',
      warnings: [],
      assets: [],
      markdown: empty
        ? ' '
        : (body ??
          '# 海岚制造\n\n## 采购约定\n供应商交付周期为十个工作日。每批货物必须附带检验记录，账期为验收后30天。'),
      parseStrategy: 'synthetic-fixture-v1',
    });
  return env.source.getRepository(Document).findOneBy({ id });
}
async function batch(documents, interval = 100) {
  const result = await preview.create('admin', {
    documentIds: documents.map((d) => d.id),
    intervalMs: interval,
  });
  return result.plan.id;
}
async function due(id) {
  await env.source.query(
    `UPDATE kh_index_upgrade_plan SET next_dispatch_at=clock_timestamp() WHERE id=$1`,
    [id],
  );
}
async function tasks(id) {
  return env.source.query(
    `SELECT t.*,i.document_id FROM kh_index_upgrade_task t JOIN kh_index_upgrade_item i ON i.id=t.item_id WHERE i.plan_id=$1 ORDER BY t.pipeline`,
    [id],
  );
}
async function direct(task) {
  return runner.run(
    { taskId: task.id, dispatchId: task.dispatch_id },
    task.pipeline,
  );
}
async function consume() {
  for (const [pipeline, queue, key] of [
    ['search', MESSAGE_QUEUE_NAMES.SEARCH, MESSAGE_ROUTING_KEYS.SEARCH_INDEX],
    ['rag', MESSAGE_QUEUE_NAMES.RAG, MESSAGE_ROUTING_KEYS.RAG_REBUILD],
    ['kg', MESSAGE_QUEUE_NAMES.KG, MESSAGE_ROUTING_KEYS.KG_REBUILD],
  ])
    await runtime.messages.consume(queue, [key], (message) =>
      runner.run(message, pipeline),
    );
  runtime.relay.onModuleInit();
}
async function drain(id) {
  await eventually(
    async () => {
      await scheduler.tick();
      return (await plans.get(id)).state === 'completed';
    },
    'batch completion',
    30000,
  );
}
test('preview classifies stored bodies, retains unknown strategies, pages, and has zero delivery/index/model side effects', async () => {
  const good = await document(),
    draft = await document({ status: 'DRAFT' }),
    missing = await document({ missing: true }),
    empty = await document({ empty: true });
  const id = await batch([good, draft, missing, empty]);
  const s = await plans.summary(id);
  assert.deepEqual(
    Object.fromEntries(
      s.classifications.map((c) => [c.classification, c.count]),
    ),
    { rebuild: 1, unpublished: 1, missing_content: 1, needs_reparse: 1 },
  );
  const first = await plans.items(id, undefined, 2),
    second = await plans.items(id, first.at(-1).id, 2);
  assert.equal(new Set([...first, ...second].map((i) => i.id)).size, 4);
  assert.ok(
    [...first, ...second].every((i) => i.previous_strategy === 'unknown'),
  );
  assert.equal(
    (
      await env.source.query(
        'SELECT count(*)::int AS count FROM kh_pipeline_outbox',
      )
    )[0].count,
    0,
  );
  assert.equal((await heads.active('rag')).length, 0);
  assert.equal(modelInputs + graphInputs, 0);
});
test('paginated metadata scan spans more than one page without loading all bodies', async () => {
  const docs = [];
  for (let i = 0; i < 52; i++) docs.push(await document({ status: 'DRAFT' }));
  const id = await batch(docs);
  assert.equal((await plans.summary(id)).classifications[0].count, 52);
  assert.equal((await plans.items(id)).length, 50);
  assert.equal(
    (await plans.items(id, (await plans.items(id)).at(-1).id)).length,
    2,
  );
});
test('transactional outbox, admission rate, idempotent start, pause/resume and restart dispatch across schedulers', async () => {
  const d = await document(),
    id = await batch([d], 60000);
  await commands.apply(id, 'start');
  await commands.apply(id, 'start');
  assert.equal(await scheduler.tick(), true);
  assert.equal(await scheduler.tick(), false);
  await commands.apply(id, 'pause');
  await due(id);
  assert.equal(await scheduler.tick(), false);
  await commands.apply(id, 'resume');
  const restarted = new UpgradeSchedulerService(
    new UpgradeDispatchStore(env.source, runtime.outbox),
    policy,
    config,
  );
  const admitted = await Promise.all([scheduler.tick(), restarted.tick()]);
  assert.equal(admitted.filter(Boolean).length, 1);
  await due(id);
  assert.equal(await restarted.tick(), false); // global in-flight bound=2
  const all = await tasks(id);
  assert.equal(all.filter((t) => t.state === 'dispatched').length, 2);
  assert.equal(
    (
      await env.source.query(
        'SELECT count(*)::int AS count FROM kh_pipeline_outbox',
      )
    )[0].count,
    2,
  );
  await commands.apply(id, 'cancel');
  assert.equal(
    (await tasks(id)).filter((t) => t.state === 'skipped').length,
    1,
  );
  // Already submitted work finishes despite cancellation; model input count is from a deterministic fixture.
  for (const task of all.filter((t) => t.state === 'dispatched'))
    await direct(task);
  assert.equal(
    (await tasks(id)).filter((t) => t.state === 'succeeded').length,
    2,
  );
});
test('real queue and stores complete all three pipelines, duplicate bodies stay in document scopes, and current activation is reported', async () => {
  const a = await document(),
    b = await document();
  // Simulate existing old chunks whose strategy metadata was never recorded.
  const oldGeneration = randomUUID();
  await vector.stageChunks(a.id, oldGeneration, [
    {
      id: `${a.id}:old`,
      documentId: a.id,
      version: 1,
      chunkIndex: 0,
      content: 'old uncontextualized fragment',
      embedding: [1, 0],
    },
  ]);
  await heads.activate(a, 'rag', oldGeneration);
  const id = await batch([a, b]);
  assert.equal(
    (await plans.items(id)).find((i) => i.document_id === a.id)
      .previous_strategy,
    'unknown',
  );
  assert.deepEqual(await heads.active('rag'), [oldGeneration]);
  await commands.apply(id, 'start');
  await consume();
  await drain(id);
  const s = await plans.summary(id);
  assert.deepEqual(s.documents, [{ state: 'succeeded', count: 2 }]);
  assert.equal(s.activeDocuments, 2);
  assert.equal((await heads.active('rag')).length, 2);
  assert.equal((await heads.active('kg')).length, 2);
  assert.equal((await heads.active('search')).length, 2);
  assert.ok(!(await heads.active('rag')).includes(oldGeneration));
  const text = await vector.searchDocuments({
    page: 1,
    pageSize: 10,
    allowedDocumentIds: [a.id, b.id],
  });
  assert.deepEqual(new Set(text.items.map((i) => i.id)), new Set([a.id, b.id]));
  const evidence = await vector.searchChunks({
    queryVector: [1, 0],
    topK: 10,
    allowedDocumentIds: [a.id, b.id],
  });
  assert.equal(new Set(evidence.map((i) => i.documentId)).size, 2);
  assert.ok(evidence.every((i) => i.content.includes('30天')));
  const paths = await graph.searchRelated({
    query: '海岚制造',
    allowedDocumentIds: [a.id, b.id],
    maxHops: 1,
    limit: 10,
  });
  assert.ok(paths.length > 0);

  assert.ok(modelInputs >= 2);
  assert.ok(graphInputs >= 2);
  assert.equal((await tasks(id)).length, 6);
  const items = await plans.items(id);
  assert.ok(items.every((i) => i.tasks.every((t) => t.active)));
  const attempts = await plans.attempts(id, items[0].tasks[0].id);
  assert.equal(attempts[0].state, 'succeeded');
  const beforeInputs = modelInputs + graphInputs;
  for (const task of await tasks(id)) await direct(task);
  assert.equal(modelInputs + graphInputs, beforeInputs);
  // A newer document revision invalidates current availability without rewriting batch history.
  await env.source.query('UPDATE kh_document SET version=2 WHERE id=$1', [
    a.id,
  ]);
  assert.equal((await plans.summary(id)).activeDocuments, 1);
  const next = await batch([b]);
  assert.equal(
    (await plans.items(next))[0].previous_strategy,
    'structure-v4:160:20',
  );
  console.log(
    JSON.stringify({
      scenario: 'two-identical-synthetic-documents',
      documents: 2,
      tasks: 6,
      activated: 6,
      deterministicEmbeddingInputs: modelInputs,
      deterministicGraphInputs: graphInputs,
    }),
  );
});
test('rechecks changed, deleted and missing bodies after preview and preserves deleted-document history', async () => {
  const changed = await document(),
    deleted = await document(),
    missing = await document();
  const id = await batch([changed, deleted, missing]);
  await env.source.query('UPDATE kh_document SET version=2 WHERE id=$1', [
    changed.id,
  ]);
  await env.source.query('DELETE FROM kh_document WHERE id=$1', [deleted.id]);
  await content.deleteByContentId(missing.contentId);
  await commands.apply(id, 'start');
  await consume();
  await drain(id);
  assert.deepEqual((await plans.summary(id)).documents, [
    { state: 'skipped', count: 3 },
  ]);
  assert.equal((await plans.items(id)).length, 3);
  assert.equal(modelInputs + graphInputs, 0);
});
test('bounded automatic retries dead-letter failure, then manual retry touches only failed pipeline', async () => {
  const d = await document(),
    id = await batch([d]);
  failGraph = true;
  await commands.apply(id, 'start');
  await consume();
  await drain(id);
  const s = await plans.summary(id);
  assert.deepEqual(s.documents, [{ state: 'failed', count: 1 }]);
  assert.equal(s.activeDocuments, 0);
  const old = await tasks(id),
    failed = old.find((t) => t.pipeline === 'kg');
  assert.equal(failed.state, 'failed');
  assert.equal(failed.error_code, 'BUILD_FAILED');
  assert.equal((await plans.attempts(id, failed.id)).length, 3);
  const embeddings = modelInputs;
  failGraph = false;
  await commands.apply(id, 'retry', failed.id);
  await direct(failed); // Old dispatch token cannot claim the newly queued round.
  await drain(id);
  const next = await tasks(id);
  assert.equal((await plans.summary(id)).activeDocuments, 1);
  assert.equal(modelInputs, embeddings);
  for (const t of old.filter((t) => t.pipeline !== 'kg'))
    assert.equal(next.find((n) => n.id === t.id).generation, t.generation);
  assert.notEqual(
    next.find((t) => t.pipeline === 'kg').dispatch_id,
    failed.dispatch_id,
  );
  assert.equal((await plans.attempts(id, failed.id)).length, 4);
  assert.ok(
    !JSON.stringify(await plans.summary(id)).includes('private-provider'),
  );
  console.log(
    JSON.stringify({
      scenario: 'graph-failure-and-retry',
      automaticAttempts: 3,
      manualAttempts: 1,
      successfulPipelinesRebuilt: 0,
      embeddingInputsOnManualRetry: modelInputs - embeddings,
    }),
  );
});
test('running attempt survives worker loss; redelivery uses a fresh generation and preserves attempt history', async () => {
  const d = await document(),
    id = await batch([d]);
  await commands.apply(id, 'start');
  await scheduler.tick();
  const [task] = (await tasks(id)).filter((t) => t.state === 'dispatched');
  const abandoned = await executions.claim(
    task.id,
    task.dispatch_id,
    task.pipeline,
  );
  assert.equal(abandoned.state, 'dispatched');
  const restored = new UpgradeExecutionStore(env.source);
  const next = await restored.claim(task.id, task.dispatch_id, task.pipeline);
  assert.notEqual(next.generation, abandoned.generation);
  assert.equal(
    (await plans.attempts(id, task.id)).find(
      (a) => a.generation === abandoned.generation,
    ).state,
    'interrupted',
  );
  await direct(task);
  assert.equal(
    (await tasks(id)).find((t) => t.id === task.id).state,
    'succeeded',
  );
});
test('config drift pauses admission and worker rejects drift before model execution', async () => {
  const d = await document(),
    id = await batch([d]);
  await commands.apply(id, 'start');
  await scheduler.tick();
  const task = (await tasks(id)).find((t) => t.state === 'dispatched');
  config.set('RAG_EMBEDDING_BATCH_SIZE', 17);
  await due(id);
  assert.equal(await scheduler.tick(), false);
  assert.equal((await plans.get(id)).state, 'paused');
  await direct(task);
  assert.equal(
    (await tasks(id)).find((t) => t.id === task.id).error_code,
    'CONFIG_MISMATCH',
  );
  assert.equal(modelInputs + graphInputs, 0);
  await assert.rejects(
    () => commands.apply(id, 'resume'),
    /UPGRADE_CONFIG_MISMATCH/,
  );
  config.set('RAG_EMBEDDING_BATCH_SIZE', 32);
});
test('activation ledger rollback prevents a head switching when durable success cannot be recorded', async () => {
  const d = await document(),
    id = await batch([d]);
  await commands.apply(id, 'start');
  await scheduler.tick();
  const task = (await tasks(id)).find((t) => t.state === 'dispatched');
  const attempt = await executions.claim(
    task.id,
    task.dispatch_id,
    task.pipeline,
  );
  await assert.rejects(
    () =>
      heads.activate(d, task.pipeline, attempt.generation, async (manager) => {
        await executions.activated(manager, attempt);
        throw new Error('ledger abort');
      }),
    /ledger abort/,
  );
  assert.equal((await heads.active(task.pipeline)).length, 0);
  assert.equal(
    (await tasks(id)).find((t) => t.id === task.id).state,
    'running',
  );
});
test('uncertain activation preserves data; durable commit reconciles success even if caller lost COMMIT acknowledgement', async () => {
  const d = await document(),
    id = await batch([d]);
  await commands.apply(id, 'start');
  await scheduler.tick();
  const task = (await tasks(id)).find((t) => t.state === 'dispatched');
  const attempt = await executions.claim(
    task.id,
    task.dispatch_id,
    task.pipeline,
  );
  assert.equal(
    await heads.activate(d, task.pipeline, attempt.generation, (m) =>
      executions.activated(m, attempt),
    ),
    true,
  );
  await executions.finish(attempt, 'activation_unknown', 'ACTIVATION_UNKNOWN');
  assert.equal(
    (await tasks(id)).find((t) => t.id === task.id).state,
    'succeeded',
  );
  assert.equal(
    await executions.claim(task.id, task.dispatch_id, task.pipeline),
    null,
  );
});

test('SIGKILL before receipt completion redelivers the same message and resumes from a fresh generation', async () => {
  const { fork } = require('node:child_process');
  const path = require('node:path');
  const d = await document(),
    id = await batch([d]);
  await commands.apply(id, 'start');
  await scheduler.tick();
  const task = (await tasks(id)).find((t) => t.state === 'dispatched');
  const child = fork(path.join(__dirname, 'upgrade-crash-worker.cjs'), [], {
    silent: true,
    env: {
      ...process.env,
      UPGRADE_TEST_DATABASE_URL: env.databaseUrl,
      UPGRADE_TEST_BROKER_URL: env.brokerUrl,
      UPGRADE_TEST_PIPELINE: task.pipeline,
    },
  });
  const messages = [];
  child.on('message', (message) => messages.push(message));
  try {
    await eventually(
      () => messages.some((m) => m.ready),
      'crash worker subscribed',
    );
    runtime.relay.onModuleInit();
    await eventually(
      () => messages.some((m) => m.claimed),
      'durable attempt claimed',
    );
    const first = messages.find((m) => m.claimed).generation;
    const exit = new Promise((resolve) => child.once('exit', resolve));
    child.kill('SIGKILL');
    await exit;
    await consume();
    await drain(id);
    const attempts = await plans.attempts(id, task.id);
    assert.equal(
      attempts.find((a) => a.generation === first).state,
      'interrupted',
    );
    assert.equal(attempts.filter((a) => a.state === 'succeeded').length, 1);
    assert.equal((await plans.summary(id)).activeDocuments, 1);
  } finally {
    if (child.exitCode === null && child.signalCode === null)
      child.kill('SIGKILL');
  }
});

test('editing during extraction keeps the old visible generation and marks the upgrade stale', async () => {
  const d = await document(),
    id = await batch([d]);
  await env.source.query(
    `UPDATE kh_index_upgrade_task SET state='skipped' WHERE pipeline<>'kg'`,
  );
  await commands.apply(id, 'start');
  await scheduler.tick();
  const task = (await tasks(id)).find((t) => t.pipeline === 'kg');
  let release;
  graphGate = new Promise((resolve) => {
    release = resolve;
  });
  const work = direct(task);
  await eventually(() => graphInputs > 0, 'graph extraction started');
  await env.source.query('UPDATE kh_document SET version=2 WHERE id=$1', [
    d.id,
  ]);
  release();
  await work;
  graphGate = null;
  assert.equal(
    (await tasks(id)).find((t) => t.id === task.id).state,
    'skipped',
  );
  assert.equal((await heads.active('kg')).length, 0);
});

test('outbox failure rolls back admission state and can be retried without losing an item', async () => {
  const d = await document(),
    id = await batch([d]);
  await commands.apply(id, 'start');
  const broken = new UpgradeSchedulerService(
    new UpgradeDispatchStore(env.source, {
      async enqueue(manager, key, payload) {
        await runtime.outbox.enqueue(manager, key, payload);
        throw new Error('injected transaction failure');
      },
    }),
    policy,
    config,
  );
  await assert.rejects(() => broken.tick(), /transaction failure/);
  assert.ok((await tasks(id)).every((t) => t.state === 'pending'));
  assert.equal(
    (
      await env.source.query(
        'SELECT count(*)::int AS count FROM kh_pipeline_outbox',
      )
    )[0].count,
    0,
  );
  assert.equal(await scheduler.tick(), true);
});

test('real management HTTP validates admin scope, pagination, commands and 202 semantics', async () => {
  const { NestFactory, Reflector } = require('@nestjs/core');
  const { Module, ValidationPipe } = require('@nestjs/common');
  const { UpgradeController } = load('pipeline/upgrades/upgrade.controller.js');
  const { UpgradeManagementService } = load(
    'pipeline/upgrades/upgrade-management.service.js',
  );
  const { RolesGuard } = load('common/auth/roles.guard.js');
  class TestModule {}
  Module({
    controllers: [UpgradeController],
    providers: [
      {
        provide: UpgradeManagementService,
        useValue: new UpgradeManagementService(plans, preview, commands),
      },
    ],
  })(TestModule);
  const app = await NestFactory.create(TestModule, { logger: false });
  app.use((req, res, next) => {
    req.user = { id: 'admin', role: req.headers['x-test-role'] };
    next();
  });
  app.useGlobalGuards(new RolesGuard(new Reflector()));
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  await app.listen(0, '127.0.0.1');
  const url = await app.getUrl();
  const request = (path, options = {}) =>
    fetch(`${url}/index-upgrades${path}`, {
      ...options,
      headers: {
        'x-test-role': 'ADMIN',
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
  try {
    assert.equal(
      (await request('', { headers: { 'x-test-role': 'MEMBER' } })).status,
      403,
    );
    assert.equal(
      (
        await request('', {
          method: 'POST',
          body: JSON.stringify({ documentIds: [], intervalMs: 0 }),
        })
      ).status,
      400,
    );
    const d = await document();
    const response = await request('', {
      method: 'POST',
      body: JSON.stringify({ documentIds: [d.id], intervalMs: 100 }),
    });
    assert.equal(response.status, 201);
    const { plan } = await response.json();
    assert.equal(plan.state, 'preview');
    assert.equal((await request(`/${plan.id}/items?limit=500`)).status, 400);
    assert.equal(
      (await request(`/${plan.id}/bogus`, { method: 'POST' })).status,
      400,
    );
    const start = await request(`/${plan.id}/start`, { method: 'POST' });
    assert.equal(start.status, 202);
    assert.deepEqual(await start.json(), { accepted: true, planId: plan.id });
    const state = await (await request(`/${plan.id}`)).json();
    assert.equal(state.activeDocuments, 0);
    assert.equal(state.documents[0].state, 'pending');
    assert.equal(
      (
        await request(`/${plan.id}/tasks/${randomUUID()}/retry`, {
          method: 'POST',
        })
      ).status,
      404,
    );
    const task = (await tasks(plan.id))[0];
    await env.source.query(
      "UPDATE kh_index_upgrade_task SET state='failed',error_code='BUILD_FAILED' WHERE id=$1",
      [task.id],
    );
    assert.equal(
      (await request(`/${plan.id}/tasks/${task.id}/retry`, { method: 'POST' }))
        .status,
      202,
    );
    assert.equal(
      (await tasks(plan.id)).find((t) => t.id === task.id).state,
      'pending',
    );
  } finally {
    await app.close();
  }
});

test('a local edit reuses unchanged document-scoped embedding inputs when upgrading the next revision', async () => {
  const original = [
    '# 海岚制造项目档案',
    ...Array.from(
      { length: 5 },
      (_, i) =>
        `## 阶段${i + 1}\n${`本阶段交付说明${i}，必须完成验收和证据存档。`.repeat(8)}`,
    ),
  ].join('\n\n');
  const d = await document({ body: original }),
    first = await batch([d]);
  await commands.apply(first, 'start');
  await consume();
  await drain(first);
  const initialInputs = modelInputs;
  assert.ok(initialInputs > 3);
  const contentId = randomUUID();
  const edited = original.replaceAll('本阶段交付说明2', '本阶段新版交付说明2');
  await content.create({
    documentId: d.id,
    contentId,
    version: 2,
    parser: 'synthetic',
    warnings: [],
    assets: [],
    markdown: edited,
    parseStrategy: 'synthetic-fixture-v1',
  });
  await env.source.query(
    'UPDATE kh_document SET content_id=$2,version=2 WHERE id=$1',
    [d.id, contentId],
  );
  const revised = await env.source
    .getRepository(Document)
    .findOneBy({ id: d.id });
  const second = await batch([revised]);
  await commands.apply(second, 'start');
  await drain(second);
  const inputsAfterEdit = modelInputs - initialInputs;
  assert.ok(inputsAfterEdit > 0 && inputsAfterEdit < initialInputs);
  assert.equal((await plans.summary(first)).activeDocuments, 0);
  assert.equal((await plans.summary(second)).activeDocuments, 1);
  console.log(
    JSON.stringify({
      scenario: 'local-edit-in-next-revision',
      initialEmbeddingInputs: initialInputs,
      embeddingInputsAfterEdit: inputsAfterEdit,
    }),
  );
});

test('broker downtime retains the admitted upgrade in Outbox and resumes without creating duplicate tasks', async () => {
  const d = await document(),
    id = await batch([d]);
  await commands.apply(id, 'start');
  await scheduler.tick();
  await env.broker('stop');
  try {
    await runtime.relay.tick();
    const [row] = await env.source.query(
      'SELECT published_at FROM kh_pipeline_outbox LIMIT 1',
    );
    assert.equal(row.published_at, null);
    assert.equal(
      (await tasks(id)).filter((t) => t.state === 'dispatched').length,
      1,
    );
  } finally {
    await env.broker('start');
  }
  await consume();
  await drain(id);
  assert.equal((await plans.summary(id)).activeDocuments, 1);
  assert.equal((await tasks(id)).length, 3);
});
