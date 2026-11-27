const assert = require('node:assert/strict');
const { drain } = require('../capacity/workload.cjs');
module.exports = async ({ env, docs, scenario, currentEntry }) => {
  const admin = await env.login('admin');
  const preview = await admin(
    'POST',
    '/index-upgrades',
    { documentIds: docs.map((d) => d.id), intervalMs: 100 },
    201,
  );
  await scenario(
    'changed strategy and same-dimension changed model both reject old preview',
    async () => {
      const before = await env.source.query(
        'SELECT * FROM kh_index_head ORDER BY document_id,pipeline',
      );
      await drain(env);
      await env.restart(currentEntry, { RAG_CHUNK_SIZE: '512' });
      await (
        await env.login('admin')
      )('POST', '/index-upgrades/' + preview.plan.id + '/start', {}, 409);
      await env.restart(currentEntry, {
        RAG_CHUNK_SIZE: '256',
        EMBEDDING_MODEL_REVISION: 'incompatible-space-not-used',
      });
      await (
        await env.login('admin')
      )('POST', '/index-upgrades/' + preview.plan.id + '/start', {}, 409);
      assert.deepEqual(
        await env.source.query(
          'SELECT * FROM kh_index_head ORDER BY document_id,pipeline',
        ),
        before,
      );
      await env.restart(currentEntry, {
        EMBEDDING_MODEL_REVISION: process.env.QUALITY_EMBEDDING_REVISION,
      });
      await (
        await env.login('admin')
      )('POST', '/index-upgrades/' + preview.plan.id + '/cancel', {}, 202);
      return {
        strategyMismatchStatus: 409,
        modelMismatchStatus: 409,
        embeddingDimensions: 768,
        headsUnchanged: true,
      };
    },
  );
};
