const assert = require('node:assert/strict');
const { eventually } = require('./environment.cjs');
async function verifyDeletion(
  env,
  actors,
  fixture,
  { id, route },
  keys,
  draft,
  ticket,
) {
  const { owner, reader } = actors;
  await owner('DELETE', route, undefined, 204);
  await owner('GET', route, undefined, 404);
  assert.equal(
    (await fetch(ticket.url)).status,
    403,
    'Existing ticket must lose access after deletion',
  );
  assert.equal(
    (
      await reader(
        'GET',
        '/search/documents?keyword=' + encodeURIComponent(fixture.id),
      )
    ).items.length,
    0,
  );
  await eventually(
    async () => {
      for (const collection of [
        'document_content',
        'document_evidence',
        'document_assets',
        'ingestion_chunks',
        'ingestion_embeddings',
      ])
        if (
          await env.db.collection(collection).countDocuments({ documentId: id })
        )
          return false;
      const es = await env.elastic.search({
        index: 'acceptance_chunks',
        size: 0,
        query: { term: { document_id: id } },
      });
      if (es.hits.total.value) return false;
      const documents = await env.elastic.count({
        index: 'acceptance_documents',
        query: { term: { id } },
      });
      if (documents.count) return false;
      const session = env.graph.session();
      try {
        const graph = await session.run(
          'MATCH (n) WHERE n.documentId=$id OR (n:KnowledgeDocument AND n.id=$id) RETURN count(n) AS count',
          { id },
        );
        if (graph.records[0].get('count').toNumber()) return false;
      } finally {
        await session.close();
      }
      for (const key of [...keys, ...draft.assets.map((x) => x.objectKey)]) {
        try {
          await env.objects.statObject('acceptance', key);
          return false;
        } catch (error) {
          if (!['NoSuchKey', 'NotFound'].includes(error.code)) throw error;
        }
      }
      return true;
    },
    'deleted source/assets/index cleanup ' + fixture.id,
    90000,
  );
  const heads = await env.source.query(
    'SELECT deleted,generation FROM kh_index_head WHERE document_id=$1',
    [id],
  );
  assert.equal(heads.length, 3);
  assert.ok(heads.every((head) => head.deleted && head.generation === null));
}
module.exports = { verifyDeletion };
