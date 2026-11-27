const assert = require('node:assert/strict');
const { eventually } = require('./environment.cjs');
module.exports = function register({ scenario, env, owner, remove, publish }) {
  scenario(
    'lost activation reply after actual commit preserves active chunks and retry completes a new generation',
    async () => {
      const doc = await env.upload(owner, 'activation-uncertain');
      await env.ready(owner, doc.id);
      await env.arm('commit-reply-lost', 'activate.rag.after', 'pause', {
        documentId: doc.id,
        throwAfter: true,
      });
      await publish(doc.id);
      await env.paused('commit-reply-lost');
      const [committed] = await env.source.query(
        "SELECT generation FROM kh_index_head WHERE document_id=$1 AND pipeline='rag'",
        [doc.id],
      );
      assert.ok(committed.generation);
      assert.ok(
        (
          await owner(
            'POST',
            '/search/semantic',
            { query: 'Original activation-uncertain', topK: 20 },
            201,
          )
        ).items.some((x) => x.documentId === doc.id),
      );
      await env.release('commit-reply-lost');
      await eventually(
        async () =>
          Boolean(
            (
              await env.source.query(
                "SELECT 1 FROM kh_index_build_progress WHERE generation=$1 AND state='activation_unknown'",
                [committed.generation],
              )
            ).length,
          ),
        'uncertain activation recorded',
      );
      await eventually(
        async () =>
          Boolean(
            (
              await env.source.query(
                "SELECT 1 FROM kh_index_head WHERE document_id=$1 AND pipeline='rag' AND generation<>$2",
                [doc.id, committed.generation],
              )
            ).length,
          ),
        'retry generation activation',
      );
      assert.ok(
        (
          await env.elastic.count({
            index: 'acceptance_chunks',
            query: { term: { generation_id: committed.generation } },
          })
        ).count > 0,
        'Possibly active generation must remain for grace-period collection',
      );
      const visible = await owner(
        'POST',
        '/search/semantic',
        { query: 'Original activation-uncertain', topK: 20 },
        201,
      );
      assert.ok(visible.items.some((x) => x.documentId === doc.id));
      await remove(doc.id);
      return {
        committedBeforeException: true,
        uncertainAttemptRecorded: true,
        retryActivated: true,
        originalGenerationPreserved: true,
        cleanup: true,
      };
    },
  );

  scenario(
    'deletion while staged index activation is paused cannot resurrect any visible generation',
    async () => {
      const doc = await env.upload(owner, 'delete-during-index');
      await env.ready(owner, doc.id);
      await env.arm('late-rag', 'activate.rag.before', 'pause', {
        documentId: doc.id,
      });
      await publish(doc.id);
      await env.paused('late-rag');
      const staged = await env.elastic.search({
        index: 'acceptance_chunks',
        query: { term: { document_id: doc.id } },
      });
      assert.ok(staged.hits.hits.length);
      await owner('DELETE', '/documents/' + doc.id, undefined, 204);
      await env.release('late-rag');
      await eventually(
        async () => {
          const hits = await env.elastic.count({
            index: 'acceptance_chunks',
            query: { term: { document_id: doc.id } },
          });
          const task = await env.db
            .collection('document_content')
            .countDocuments({ documentId: doc.id });
          return hits.count === 0 && task === 0;
        },
        'late index discarded',
        30000,
      );
      const heads = await env.source.query(
        'SELECT * FROM kh_index_head WHERE document_id=$1',
        [doc.id],
      );
      assert.equal(heads.length, 3);
      assert.ok(heads.every((h) => h.deleted && h.generation === null));
      await owner('GET', '/documents/' + doc.id, undefined, 404);
      const results = await owner(
        'GET',
        '/search/documents?keyword=delete-during-index',
      );
      assert.equal(results.items.length, 0);
      return {
        lateActivationRejected: true,
        tombstonedPipelines: 3,
        stagedChunksRemoved: true,
        cleanup: true,
      };
    },
  );
};
