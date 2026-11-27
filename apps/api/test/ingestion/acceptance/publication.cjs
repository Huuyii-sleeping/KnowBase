const assert = require('node:assert/strict');
const { eventually } = require('./environment.cjs');
const { normalize } = require('./values.cjs');
async function publishAndSearch(
  env,
  actors,
  fixture,
  { id, route, document },
  { body },
) {
  const { owner, reader, admin, outsider } = actors;
  await owner('POST', route + '/submit-review', {}, 201);
  await reader('POST', route + '/review', { approved: true }, 403);
  await admin('POST', route + '/review', { approved: true }, 201);
  await eventually(
    async () => {
      const heads = await env.source.query(
        'SELECT pipeline,generation,version,deleted FROM kh_index_head WHERE document_id=$1',
        [id],
      );
      return (
        heads.length === 3 &&
        heads.every(
          (h) => h.generation && !h.deleted && h.version === document.version,
        )
      );
    },
    'all published generations ' + fixture.id,
    300000,
  );
  const indexStatus = await owner('GET', route + '/index-status');
  assert.ok(
    ['search', 'rag', 'kg'].every((p) =>
      indexStatus.attempts.some(
        (a) => a.pipeline === p && a.state === 'succeeded' && a.currentVersion,
      ),
    ),
  );
  await outsider('GET', route, undefined, 403);
  await reader('GET', route + '/index-status', undefined, 403);
  assert.ok(
    (
      await reader(
        'GET',
        '/search/documents?keyword=' + encodeURIComponent(fixture.id),
      )
    ).items.some((x) => x.id === id),
  );
  const semantic = await reader(
    'POST',
    '/search/semantic',
    { query: fixture.facts[0], topK: 20 },
    201,
  );
  const evidenceHits = semantic.items.filter((x) => x.documentId === id);
  assert.ok(evidenceHits.length, 'Published chunk absent from semantic search');
  assert.ok(
    fixture.facts.every((f) =>
      evidenceHits.some((h) => normalize(h.content).includes(normalize(f))),
    ),
    'Published chunks lost facts',
  );
  assert.equal(
    (
      await outsider(
        'POST',
        '/search/semantic',
        { query: fixture.facts[0], topK: 20 },
        201,
      )
    ).items.some((x) => x.documentId === id),
    false,
  );
  const hits = await env.elastic.search({
    index: 'acceptance_chunks',
    size: 1000,
    query: { term: { document_id: id } },
  });
  assert.ok(hits.hits.hits.length);
  for (const hit of hits.hits.hits)
    assert.ok(hit._source.ingestion.ranges.length);
  if (fixture.scan) {
    const chunks = hits.hits.hits.map((x) => ({
      content: x._source.content,
      ranges: x._source.ingestion.ranges,
    }));
    const {
      tableChunkDelivery,
    } = require('../complex-quality/table-delivery.cjs');
    assert.deepEqual(
      tableChunkDelivery(body, chunks).map((x) => [
        x.expectedRows,
        x.matchedRows,
      ]),
      [[3, 3]],
    );
  }
  await reader('GET', route);
  await reader('GET', route + '/evidence?limit=100');
  const ticket = await reader(
    'GET',
    '/storage/access?key=' + encodeURIComponent(document.storageKey),
  );

  assert.equal((await fetch(ticket.url)).status, 200);
  return { evidenceHits, ticket };
}
module.exports = { publishAndSearch };
