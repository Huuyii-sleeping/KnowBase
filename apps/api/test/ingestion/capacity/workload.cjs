const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { setTimeout: pause } = require('node:timers/promises');
const { createHash } = require('node:crypto');
const { boundedMap, fixture } = require('./metrics.cjs');
async function until(check, label, timeout = 90000) {
  const start = performance.now();
  while (performance.now() - start < timeout) {
    if (await check()) return;
    await pause(150);
  }
  throw Error('Capacity timeout: ' + label);
}
async function ingest(env, actors, bytes, ordinal, created) {
  const input = fixture(bytes, ordinal);
  const name = `capacity-${ordinal}`;
  const form = new FormData();
  form.set('file', new Blob([input.data]), name + '.txt');
  form.set('title', name);
  const start = performance.now();
  const doc = await actors.owner('POST', '/documents', form, 201);
  created.push(doc);
  const uploaded = performance.now();
  const route = '/documents/' + doc.id;
  let parsed;
  await until(async () => {
    parsed = await actors.owner('GET', route);
    if (
      parsed.parseStatus === 'FAILED' ||
      parsed.ingestion?.task?.state === 'needs_review'
    )
      throw Error('Unexpected parser failure or review requirement');
    return parsed.parseStatus === 'READY' && Boolean(parsed.content);
  }, 'parse ' + name);
  const ready = performance.now();
  assert.equal(
    parsed.content.markdown,
    `# ${name}\n\n${input.data.toString()}\n`,
  );
  await actors.owner('POST', route + '/submit-review', {}, 201);
  await actors.admin('POST', route + '/review', { approved: true }, 201);
  const published = performance.now();
  let heads;
  await until(async () => {
    heads = await env.source.query(
      'SELECT pipeline,version,generation,deleted FROM kh_index_head WHERE document_id=$1',
      [doc.id],
    );
    return (
      heads.length === 3 &&
      heads.every(
        (h) => h.version === parsed.version && h.generation && !h.deleted,
      )
    );
  }, 'index ' + name);
  const active = performance.now();
  const chunks = await env.elastic.search({
    index: 'acceptance_chunks',
    size: 1000,
    query: { term: { document_id: doc.id } },
  });
  assert.ok(chunks.hits.hits.length > 0 && chunks.hits.hits.length < 1000);
  assert.ok(
    chunks.hits.hits.some((h) => h._source.content.includes(input.fact)),
  );
  assert.ok(
    chunks.hits.hits.every((h) => h._source.ingestion.ranges.length > 0),
  );
  const body = await env.db
    .collection('document_content')
    .findOne({ contentId: parsed.contentId });
  assert.equal(body.markdown, parsed.content.markdown);
  const original = await env.objects.getObject('acceptance', doc.storageKey);
  const buffers = [];
  for await (const buffer of original) buffers.push(buffer);
  assert.equal(
    createHash('sha256').update(Buffer.concat(buffers)).digest('hex'),
    input.sha256,
  );
  return {
    documentId: doc.id,
    bytes,
    ordinal,
    inputSha256: input.sha256,
    chunks: chunks.hits.hits.length,
    uploadMs: uploaded - start,
    parseReadyMs: ready - start,
    publishMs: published - ready,
    indexActiveMs: active - published,
    endToEndMs: active - start,
    verifiedMs: performance.now() - start,
    bodyAndSourceReadback: true,
    criticalFactIndexed: true,
  };
}
async function drain(env) {
  await until(async () => {
    const [counts] = await env.source.query(`SELECT
      (SELECT count(*)::int FROM kh_pipeline_outbox WHERE published_at IS NULL) AS pending,
      (SELECT count(*)::int FROM kh_pipeline_receipt WHERE status<>'COMPLETED') AS incomplete`);
    return counts.pending === 0 && counts.incomplete === 0;
  }, 'delivery drain');
}
async function cleanup(env, owner, docs) {
  await boundedMap(docs, 4, (doc) =>
    owner('DELETE', '/documents/' + doc.id, undefined, 204),
  );
  await drain(env);
  const ids = docs.map((d) => d.id);
  if (!ids.length) return;
  await until(async () => {
    try {
      await verifyCleanup(env, docs, ids);
      return true;
    } catch (error) {
      if (error.code === 'ERR_ASSERTION') return false;
      throw error;
    }
  }, 'source/index cleanup');
  await drain(env);
}
async function verifyCleanup(env, docs, ids) {
  for (const collection of [
    'document_content',
    'document_evidence',
    'document_assets',
    'ingestion_chunks',
    'ingestion_embeddings',
  ])
    assert.equal(
      await env.db
        .collection(collection)
        .countDocuments({ documentId: { $in: ids } }),
      0,
      collection + ' cleanup',
    );
  for (const [index, field] of [
    ['acceptance_documents', 'id'],
    ['acceptance_chunks', 'document_id'],
  ])
    assert.equal(
      (await env.elastic.count({ index, query: { terms: { [field]: ids } } }))
        .count,
      0,
      index + ' cleanup',
    );
  const session = env.graph.session();
  try {
    const result = await session.run(
      'MATCH (n) WHERE n.documentId IN $ids OR (n:KnowledgeDocument AND n.id IN $ids) RETURN count(n) AS count',
      { ids },
    );
    assert.equal(result.records[0].get('count').toNumber(), 0);
  } finally {
    await session.close();
  }
  for (const doc of docs) {
    await assert.rejects(
      () => env.objects.statObject('acceptance', doc.storageKey),
      (error) => ['NoSuchKey', 'NotFound'].includes(error.code),
    );
  }
  const heads = await env.source.query(
    'SELECT deleted,generation FROM kh_index_head WHERE document_id=ANY($1::uuid[])',
    [ids],
  );
  assert.equal(heads.length, ids.length * 3);
  assert.ok(heads.every((h) => h.deleted && h.generation === null));
}
module.exports = { ingest, drain, cleanup };
