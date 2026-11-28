const assert = require('node:assert/strict');
const { test, before, after, beforeEach } = require('node:test');
const { randomUUID } = require('node:crypto');
const { ConfigService } = require('@nestjs/config');
const {
  DeliveryTestEnvironment,
  eventually,
} = require('../delivery/environment.cjs');
const { load, MESSAGE_QUEUE_NAMES } = require('../delivery/runtime.cjs');
const { Document } = load('documents/entities/document.entity.js');
const { ParseTaskStore } = load('documents/ingestion/parse-task.store.js');
const { ParseTaskCleanupStore } = load(
  'documents/ingestion/parse-task-cleanup.store.js',
);
const { ParseSubmissionService } = load(
  'documents/ingestion/parse-submission.service.js',
);
const { ParseResultService } = load(
  'documents/ingestion/parse-result.service.js',
);
const { DocumentRevisionService } = load(
  'documents/document-revision.service.js',
);
const { DocumentDeletionService } = load(
  'documents/document-deletion.service.js',
);
const { IndexGenerationStore } = load('indexing/index-generation.store.js');
const env = new DeliveryTestEnvironment();
let runtime, tasks, submission, bodies, content;
const user = { id: 'owner', role: 'MEMBER' };
const access = {
  assertCanEdit: (document, actor) => {
    if (document.uploaderId !== actor.id && actor.role !== 'ADMIN')
      throw new Error('forbidden');
  },
  assertCanView: (document, actor) => {
    if (document.uploaderId !== actor.id && actor.role !== 'ADMIN')
      throw new Error('forbidden');
  },
};
before(() => env.start(), { timeout: 120000 });
after(() => env.close(), { timeout: 120000 });
beforeEach(async () => {
  await env.reset();
  runtime = env.runtime();
  const config = new ConfigService({
    INGESTION_ASYNC_ENABLED: true,
    INGESTION_TASK_LEASE_MS: 3000,
  });
  tasks = new ParseTaskStore(env.source, runtime.outbox, config);
  submission = new ParseSubmissionService(env.source, tasks, access, config);
  bodies = new Map();
  content = {
    verifyEvidence: async () => undefined,
    findByContentId: async (id) => bodies.get(id),
    create: async (value) => {
      bodies.set(value.contentId, value);
    },
    deleteByContentId: async (id) => {
      bodies.delete(id);
    },
  };
});
async function document() {
  const document = env.source.getRepository(Document).create({
    id: randomUUID(),
    title: 'Original',
    fileName: 'report.pdf',
    mimeType: 'application/pdf',
    fileSize: 100,
    storageKey: `original/${randomUUID()}/report.pdf`,
    contentId: randomUUID(),
    uploaderId: user.id,
    status: 'DRAFT',
    parseStatus: 'PENDING',
    tags: [],
    permissions: {},
  });
  await submission.create(document);
  return document;
}
const parsed = {
  markdown: '# 标题\n\n正文。',
  ready: true,
  parser: 'mineru',
  warnings: [],
  assets: [],
  quality: { status: 'accepted', issues: [] },
};

test('upload metadata and parse command commit together; duplicate delivery has one owner', async () => {
  const doc = await document();
  const task = await tasks.latest(doc.id);
  const seen = [];
  await runtime.consumers.subscribe(
    MESSAGE_QUEUE_NAMES.PARSE,
    async (payload) => {
      const claimed = await tasks.claim(payload.taskId);
      if (claimed) seen.push(claimed);
    },
  );
  runtime.relay.onModuleInit();
  await eventually(() => seen.length === 1, 'parse command delivered');
  assert.equal(await tasks.claim(task.id), undefined);
  await new ParseResultService(env.source, content, tasks).apply(
    seen[0],
    parsed,
  );
  const current = await env.source
    .getRepository(Document)
    .findOneBy({ id: doc.id });
  assert.equal(current.parseStatus, 'READY');
  assert.equal((await tasks.find(task.id)).state, 'completed');
  assert.equal(current.contentId, seen[0].content_id);
});

test('outbox failure rolls back document and task creation', async () => {
  const failingTasks = new ParseTaskStore(
    env.source,
    {
      schedule: async () => {
        throw new Error('outbox unavailable');
      },
    },
    new ConfigService(),
  );
  const failing = new ParseSubmissionService(
    env.source,
    failingTasks,
    access,
    new ConfigService(),
  );
  const id = randomUUID();
  const doc = env.source.getRepository(Document).create({
    id,
    title: 'Failed',
    fileName: 'f.pdf',
    mimeType: 'application/pdf',
    storageKey: `original/${id}`,
    contentId: randomUUID(),
    uploaderId: user.id,
  });
  await assert.rejects(failing.create(doc), /outbox unavailable/);
  assert.equal(
    await env.source.getRepository(Document).findOneBy({ id }),
    null,
  );
  assert.equal(await tasks.latest(id), undefined);
});

test('expired work resumes its remote task, fences the old owner and stops at the retry budget', async () => {
  const doc = await document();
  const first = await tasks.claim((await tasks.latest(doc.id)).id);
  await tasks.remote(first, 'existing-mineru-task');
  await tasks.asset(first, {
    type: 'image',
    objectKey: `assets/${doc.id}/old.png`,
    url: '/old',
  });
  await env.source.query(
    "UPDATE kh_document_parse_task SET lease_until=clock_timestamp()-INTERVAL '1 second' WHERE id=$1",
    [first.id],
  );
  await tasks.recover();
  const second = await tasks.claim(first.id);
  assert.equal(second.remote_task_id, 'existing-mineru-task');
  assert.notEqual(second.content_id, first.content_id);
  await assert.rejects(tasks.heartbeat(first), /no longer owns/);
  await tasks.retry(second);
  const third = await tasks.claim(first.id);
  await tasks.retry(third);
  assert.equal((await tasks.find(first.id)).state, 'failed');
  assert.equal(
    (await env.source.getRepository(Document).findOneBy({ id: doc.id }))
      .parseStatus,
    'FAILED',
  );
  const cleanup = await env.source.query(
    "SELECT body FROM kh_pipeline_outbox WHERE routing_key='document.assets.delete'",
  );
  assert.equal(JSON.parse(cleanup[0].body).keys[0], `assets/${doc.id}/old.png`);
});

test('manual edits invalidate active work; stale results cannot replace the edited body', async () => {
  const doc = await document();
  const task = await tasks.claim((await tasks.latest(doc.id)).id);
  const revisions = new DocumentRevisionService(
    env.source,
    content,
    access,
    tasks,
  );
  await revisions.updateContent(doc.id, { markdown: '手工编辑' }, user);
  const results = new ParseResultService(env.source, content, tasks);
  await assert.rejects(results.apply(task, parsed), /no longer owns/);
  await results.discardIfUnreferenced(task);
  const current = await env.source
    .getRepository(Document)
    .findOneBy({ id: doc.id });
  assert.equal(bodies.get(current.contentId).markdown, '手工编辑');
  assert.equal(bodies.has(task.content_id), false);
  assert.equal((await tasks.find(task.id)).state, 'stale');
});

test('cancellation, authorization, reparse and deletion never revive old work', async () => {
  const doc = await document();
  await assert.rejects(
    submission.status(doc.id, { id: 'other', role: 'MEMBER' }),
    /forbidden/,
  );
  const task = await tasks.claim((await tasks.latest(doc.id)).id);
  await submission.cancel(doc.id, user);
  assert.equal((await tasks.find(task.id)).state, 'canceled');
  await assert.rejects(
    new ParseResultService(env.source, content, tasks).apply(task, parsed),
    /no longer owns/,
  );
  const reparse = await submission.reparse(doc.id, user);
  const current = await env.source
    .getRepository(Document)
    .findOneBy({ id: doc.id });
  assert.equal(current.version, 1);
  assert.equal(current.parseStatus, 'FAILED');
  assert.equal(current.contentId, doc.contentId);
  assert.equal((await tasks.find(reparse.taskId)).requires_review, true);
  await new DocumentDeletionService(
    env.source,
    access,
    new IndexGenerationStore(env.source),
    { deleteDocument: async () => {} },
    tasks,
  ).remove(doc.id, user);
  assert.equal((await tasks.find(reparse.taskId)).state, 'stale');
  assert.equal(await tasks.claim(reparse.taskId), undefined);
});

test('attempt cleanup excludes adopted history and current work, and cancels only matching remote configuration', async () => {
  const doc = await document();
  const cleanup = new ParseTaskCleanupStore(env.source);
  const first = await tasks.claim((await tasks.latest(doc.id)).id);
  await tasks.remote(first, 'adopted-remote');
  await new ParseResultService(env.source, content, tasks).apply(first, parsed);
  assert.deepEqual((await tasks.find(first.id)).content_ids, []);
  const revisions = new DocumentRevisionService(
    env.source,
    content,
    access,
    tasks,
  );
  await revisions.updateContent(
    doc.id,
    { markdown: '保留历史图片的人工正文' },
    user,
  );
  await submission.reparse(doc.id, user);
  const second = await tasks.claim((await tasks.latest(doc.id)).id);
  await tasks.remote(second, 'abandoned-remote');
  await tasks.retry(second);
  const third = await tasks.claim(second.id);
  await env.source.query(
    "UPDATE kh_document_parse_task SET updated_at=clock_timestamp()-INTERVAL '2 days' WHERE document_id=$1",
    [doc.id],
  );
  const candidates = await cleanup.orphanContents();
  assert.deepEqual(
    candidates.map((row) => row.content_id),
    [second.content_id],
  );
  assert.equal(
    candidates.some(
      (row) =>
        row.content_id === first.content_id ||
        row.content_id === third.content_id,
    ),
    false,
  );
  await cleanup.forgetContent(doc.id, second.content_id);
  assert.deepEqual(await cleanup.orphanContents(), []);
  await submission.cancel(doc.id, user);
  assert.deepEqual(
    await cleanup.remoteCancellations('changed-configuration'),
    [],
  );
  assert.equal(
    (await cleanup.remoteCancellations(tasks.fingerprint))[0].remote_task_id,
    'abandoned-remote',
  );
  await cleanup.remoteCanceled(second.id);
  assert.deepEqual(await cleanup.remoteCancellations(tasks.fingerprint), []);
});

test('durable extraction resumes after publication failure without reading or parsing the source again', async () => {
  const { ParseJobService } = load('documents/ingestion/parse-job.service.js');
  const { Readable } = require('node:stream');
  const doc = await document();
  const results = new ParseResultService(env.source, content, tasks);
  let fail = true,
    reads = 0,
    parses = 0;
  const originalApply = results.apply.bind(results);
  results.apply = async (...args) => {
    if (fail) {
      fail = false;
      throw new Error('publication offline');
    }
    return originalApply(...args);
  };
  const job = new ParseJobService(
    env.source,
    tasks,
    {
      parse: async (_buffer, _name, _id, execution) => {
        parses++;
        await execution.onAsset({
          type: 'image',
          objectKey: `assets/${doc.id}/checkpoint.png`,
          url: '/checkpoint',
        });
        return {
          ...parsed,
          assets: [
            {
              type: 'image',
              objectKey: `assets/${doc.id}/checkpoint.png`,
              url: '/checkpoint',
            },
          ],
        };
      },
    },
    {
      getObject: async () => {
        reads++;
        return Readable.from([Buffer.from('original')]);
      },
    },
    results,
    new ConfigService(),
  );
  const id = (await tasks.latest(doc.id)).id;
  await job.run(id);
  const checkpoint = await tasks.find(id);
  assert.equal(checkpoint.state, 'queued');
  assert.equal(checkpoint.checkpoint_content_id, checkpoint.content_id);
  assert.equal(checkpoint.assets.length, 1);
  assert.ok(bodies.has(checkpoint.content_id));
  await job.run(id);
  assert.equal((await tasks.find(id)).state, 'completed');
  assert.equal(reads, 1);
  assert.equal(parses, 1);
  assert.equal(
    (await env.source.getRepository(Document).findOneBy({ id: doc.id }))
      .contentId,
    checkpoint.content_id,
  );
});

test('missing checkpoints are invalidated so recovery can extract a new artifact', async () => {
  const { ParseJobService } = load('documents/ingestion/parse-job.service.js');
  const doc = await document();
  const task = await tasks.claim((await tasks.latest(doc.id)).id);
  await new ParseResultService(env.source, content, tasks).checkpoint(
    task,
    parsed,
  );
  bodies.delete(task.content_id);
  await tasks.retry(task);
  await new ParseJobService(
    env.source,
    tasks,
    {},
    {},
    new ParseResultService(env.source, content, tasks),
    new ConfigService(),
  ).run(task.id);
  assert.equal((await tasks.find(task.id)).checkpoint_content_id, null);
  const next = await tasks.claim(task.id);
  assert.notEqual(next.content_id, task.content_id);
});

test('published reparse retains the current revision until a verified draft is explicitly adopted', async () => {
  const { ParseDraftService } = load(
    'documents/ingestion/parse-draft.service.js',
  );
  const doc = await document();
  const initial = await tasks.claim((await tasks.latest(doc.id)).id);
  const results = new ParseResultService(env.source, content, tasks);
  await results.apply(initial, parsed);
  await env.source
    .getRepository(Document)
    .update(doc.id, { status: 'PUBLISHED' });
  const { taskId } = await submission.reparse(doc.id, user);
  const candidate = await tasks.claim(taskId);
  await results.apply(candidate, {
    ...parsed,
    markdown: '待确认内容',
    ready: false,
    quality: {
      status: 'needs_review',
      issues: [{ code: 'TEST', message: '核对数字' }],
    },
  });
  const before = await env.source
    .getRepository(Document)
    .findOneBy({ id: doc.id });
  assert.equal(before.status, 'PUBLISHED');
  assert.equal(before.parseStatus, 'READY');
  assert.equal(before.contentId, initial.content_id);
  const drafts = new ParseDraftService(env.source, content, tasks, access);
  await assert.rejects(
    drafts.read(doc.id, taskId, { id: 'stranger', role: 'MEMBER' }),
    /forbidden/,
  );
  await assert.rejects(
    drafts.review(doc.id, { taskId, accept: true, note: '核对完成' }, user),
    /Acknowledge/,
  );
  assert.equal((await tasks.find(taskId)).state, 'needs_review');
  await drafts.review(
    doc.id,
    {
      taskId,
      accept: true,
      note: '已对照原件核对数字',
      acknowledgeIssues: true,
    },
    user,
  );
  const adopted = await env.source
    .getRepository(Document)
    .findOneBy({ id: doc.id });
  assert.equal(adopted.contentId, candidate.content_id);
  assert.equal(adopted.version, before.version + 1);
  assert.equal(bodies.get(adopted.contentId).version, adopted.version);
  assert.equal(adopted.status, 'DRAFT');
  assert.equal((await tasks.find(taskId)).reviewed_by, user.id);
  await assert.rejects(
    drafts.review(doc.id, { taskId, accept: false, note: '重复操作' }, user),
    /no longer current/,
  );
});

test('rejecting or superseding a draft never replaces the adopted body and schedules asset cleanup', async () => {
  const { ParseDraftService } = load(
    'documents/ingestion/parse-draft.service.js',
  );
  const doc = await document();
  const initial = await tasks.claim((await tasks.latest(doc.id)).id);
  const results = new ParseResultService(env.source, content, tasks);
  await results.apply(initial, parsed);
  const { taskId } = await submission.reparse(doc.id, user);
  const candidate = await tasks.claim(taskId);
  await tasks.asset(candidate, {
    type: 'image',
    objectKey: `assets/${doc.id}/rejected.png`,
    url: '/rejected',
  });
  await results.apply(candidate, parsed);
  const drafts = new ParseDraftService(env.source, content, tasks, access);
  await assert.rejects(
    drafts.review(doc.id, { taskId, accept: false, note: '' }, user),
    /note/,
  );
  await drafts.review(
    doc.id,
    { taskId, accept: false, note: '图片内容缺失' },
    user,
  );
  assert.equal((await tasks.find(taskId)).state, 'canceled');
  assert.equal(
    (await env.source.getRepository(Document).findOneBy({ id: doc.id }))
      .contentId,
    initial.content_id,
  );
  const events = await env.source.query(
    "SELECT body FROM kh_pipeline_outbox WHERE routing_key='document.assets.delete'",
  );
  assert.ok(
    events.some((event) =>
      JSON.parse(event.body).keys.includes(`assets/${doc.id}/rejected.png`),
    ),
  );
  const next = await submission.reparse(doc.id, user);
  const nextTask = await tasks.claim(next.taskId);
  await results.apply(nextTask, parsed);
  await new DocumentRevisionService(
    env.source,
    content,
    access,
    tasks,
  ).updateContent(doc.id, { markdown: '人工更新' }, user);
  await assert.rejects(
    drafts.read(doc.id, next.taskId, user),
    /no longer current/,
  );
});
