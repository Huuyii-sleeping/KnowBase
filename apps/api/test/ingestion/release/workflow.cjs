const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { eventually } = require('../acceptance/environment.cjs');
const sha = (data) => createHash('sha256').update(data).digest('hex');
async function upload(env, data, name) {
  const owner = await env.login('owner');
  const form = new FormData();
  form.set('file', new Blob([data]), name);
  form.set('title', name);
  form.set('team', 'quality');
  form.set('visibility', 'TEAM');
  const created = await owner('POST', '/documents', form, 201);
  let doc;
  await eventually(
    async () => {
      doc = await owner('GET', '/documents/' + created.id);
      return (
        (doc.parseStatus === 'READY' && doc.content) ||
        doc.ingestion?.task?.state === 'needs_review'
      );
    },
    'release parse ' + name,
    300000,
  );
  if (doc.ingestion.task.state === 'needs_review') {
    await owner(
      'POST',
      '/documents/' + doc.id + '/parse-review',
      {
        taskId: doc.ingestion.task.id,
        accept: true,
        acknowledgeIssues: true,
        note: '核对合成发布演练原件',
      },
      201,
    );
    doc = await owner('GET', '/documents/' + doc.id);
  }
  return {
    id: doc.id,
    storageKey: doc.storageKey,
    contentId: doc.contentId,
    version: doc.version,
    bodySha256: sha(doc.content.markdown),
    sourceSha256: sha(data),
    markdown: doc.content.markdown,
  };
}
async function publish(env, doc) {
  const owner = await env.login('owner'),
    admin = await env.login('admin');
  await owner('POST', '/documents/' + doc.id + '/submit-review', {}, 201);
  await admin(
    'POST',
    '/documents/' + doc.id + '/review',
    { approved: true },
    201,
  );
  await active(env, doc.id, doc.version);
}
async function active(env, id, version) {
  let heads;
  await eventually(
    async () => {
      heads = await env.source.query(
        'SELECT pipeline,generation,version,deleted FROM kh_index_head WHERE document_id=$1 ORDER BY pipeline',
        [id],
      );
      return (
        heads.length === 3 &&
        heads.every((h) => h.generation && !h.deleted && h.version === version)
      );
    },
    'release activated',
    300000,
  );
  return heads;
}
async function readback(env, doc, search = true) {
  const owner = await env.login('owner');
  const result = await owner('GET', '/documents/' + doc.id);
  assert.equal(result.version, doc.version);
  assert.equal(result.contentId, doc.contentId);
  assert.equal(sha(result.content.markdown), doc.bodySha256);
  const original = await env.objects.getObject('acceptance', doc.storageKey);
  const parts = [];
  for await (const part of original) parts.push(part);
  assert.equal(sha(Buffer.concat(parts)), doc.sourceSha256);
  if (search) {
    const heads = await active(env, doc.id, doc.version);
    const rag = heads.find((h) => h.pipeline === 'rag');
    const chunks = await env.elastic.search({
      index: 'acceptance_chunks',
      size: 1000,
      query: { term: { generation_id: rag.generation } },
    });
    assert.ok(chunks.hits.hits.length);
    assert.ok(
      chunks.hits.hits.some(
        (h) =>
          h._source.content.includes('731') ||
          h._source.content.includes('-8.75'),
      ),
    );
    assert.ok(chunks.hits.hits.every((h) => h._source.ingestion.ranges.length));
    const reader = await env.login('reader');
    const found = await reader(
      'GET',
      '/search/documents?keyword=' + encodeURIComponent(result.title),
    );
    assert.ok(found.items.some((d) => d.id === doc.id));
  }
  return {
    bodyUnchanged: true,
    sourceUnchanged: true,
    versionUnchanged: true,
    indexVisible: search,
  };
}
async function upgrade(env, docs) {
  const admin = await env.login('admin');
  const before = await env.source.query(
    'SELECT id,content_id,version FROM kh_document WHERE id=ANY($1::uuid[]) ORDER BY id',
    [docs.map((d) => d.id)],
  );
  const preview = await admin(
    'POST',
    '/index-upgrades',
    { documentIds: docs.map((d) => d.id), intervalMs: 100 },
    201,
  );
  assert.equal(preview.plan.state, 'preview');
  await admin('POST', '/index-upgrades/' + preview.plan.id + '/start', {}, 202);
  let summary;
  await eventually(
    async () => {
      summary = await admin('GET', '/index-upgrades/' + preview.plan.id);
      return summary.plan.state === 'completed';
    },
    'release upgrade completed',
    300000,
  );
  assert.equal(summary.activeDocuments, docs.length);
  assert.equal(
    summary.tasks.reduce(
      (n, t) => n + (t.state === 'succeeded' ? t.count : 0),
      0,
    ),
    docs.length * 3,
  );
  assert.deepEqual(
    await env.source.query(
      'SELECT id,content_id,version FROM kh_document WHERE id=ANY($1::uuid[]) ORDER BY id',
      [docs.map((d) => d.id)],
    ),
    before,
  );
  for (const doc of docs) await readback(env, doc);
  return {
    planId: preview.plan.id,
    documents: docs.length,
    activeDocuments: summary.activeDocuments,
    tasks: summary.tasks,
    target: summary.plan.target,
    targetHash: summary.plan.target_hash,
    bodyUnchanged: true,
  };
}
module.exports = { upload, publish, active, readback, upgrade, sha };
