const assert = require('node:assert/strict');
const amqp = require('amqplib');
const { rollbackSnapshot, rollbackBlockers } = require('./rollback-gate.cjs');
const { readback, sha } = require('./workflow.cjs');
const { eventually } = require('../acceptance/environment.cjs');
const { drain, cleanup } = require('../capacity/workload.cjs');
const { MESSAGE_QUEUE_NAMES } = require('../../delivery/runtime.cjs');
module.exports = async ({
  env,
  docs,
  scenario,
  oldEntry,
  currentEntry,
  draft,
  report,
}) => {
  await scenario(
    'rollback gate rejects live consumers and dead-letter messages',
    async () => {
      await drain(env);
      const live = await rollbackSnapshot(env);
      assert.ok(rollbackBlockers(live).includes('queueConsumers'));
      await env.stopApplication();
      const dead = MESSAGE_QUEUE_NAMES.PARSE + '.dead';
      const publisher = await amqp.connect(env.brokerUrl);
      try {
        const channel = await publisher.createConfirmChannel();
        channel.sendToQueue(dead, Buffer.from('release gate sentinel'), {
          persistent: true,
        });
        await channel.waitForConfirms();
      } finally {
        await publisher.close();
      }
      const blocked = await rollbackSnapshot(env);
      assert.ok(rollbackBlockers(blocked).includes('queueReady'));
      await env.withChannel(async (channel) => {
        const message = await channel.get(dead);
        assert.ok(message);
        channel.ack(message);
        await channel.checkQueue(dead);
      });
      let clear;
      await eventually(
        async () => {
          clear = await rollbackSnapshot(env);
          return rollbackBlockers(clear).length === 0;
        },
        'rollback drain gate',
        30000,
      );
      return {
        liveRejected: rollbackBlockers(live),
        deadLetterRejected: rollbackBlockers(blocked),
        clear,
      };
    },
  );
  await scenario(
    'old binary and old chunk strategy read newer data without dropping schema',
    async () => {
      await env.restart(oldEntry, { RAG_CHUNK_SIZE: '1000' });
      for (const doc of docs) await readback(env, doc);
      const owner = await env.login('owner');
      const candidate = await owner(
        'GET',
        '/documents/' + draft.documentId + '/parse-drafts/' + draft.taskId,
      );
      assert.equal(sha(candidate.markdown), draft.bodySha256);
      assert.deepEqual(
        candidate.assets.map((a) => a.objectKey),
        draft.assets,
      );
      for (const key of draft.assets)
        await env.objects.statObject('acceptance', key);
      const oldHeads = await env.source.query(
        'SELECT pipeline,generation FROM kh_index_head WHERE document_id=$1',
        [docs[0].id],
      );
      await (
        await env.login('admin')
      )('POST', '/documents/' + docs[0].id + '/rebuild-indexes', {}, 202);
      await eventually(
        async () => {
          const current = await env.source.query(
            'SELECT pipeline,generation FROM kh_index_head WHERE document_id=$1',
            [docs[0].id],
          );
          return (
            current.length === 3 &&
            current.every(
              (h) =>
                h.generation !==
                oldHeads.find((old) => old.pipeline === h.pipeline).generation,
            )
          );
        },
        'old strategy rebuild',
        300000,
      );
      for (const doc of docs) await readback(env, doc);
      await drain(env);
      return {
        rollbackRevision: report.rollbackArtifact.revision,
        strategy: 'structure-v4:1000:20',
        currentBodiesPreserved: true,
        candidatePreserved: true,
        oldBinaryRebuild: true,
        additiveTablesRetained: true,
      };
    },
  );
  await scenario(
    'roll forward restores batch management and deletes all test artifacts',
    async () => {
      await env.stopApplication();
      assert.deepEqual(rollbackBlockers(await rollbackSnapshot(env)), []);
      await env.restart(currentEntry, { RAG_CHUNK_SIZE: '256' });
      for (const doc of docs) await readback(env, doc);
      const owner = await env.login('owner');
      await owner(
        'POST',
        '/documents/' + draft.documentId + '/parse-review',
        {
          taskId: draft.taskId,
          accept: false,
          acknowledgeIssues: false,
          note: '发布演练保留已发布正文，拒绝候选',
        },
        201,
      );
      await cleanup(env, owner, docs);
      // Remote cancellation is asynchronous maintenance, not covered by queue receipts.
      await eventually(
        async () => {
          const snapshot = await rollbackSnapshot(env);
          return (
            rollbackBlockers(snapshot).filter((key) => key !== 'queueConsumers')
              .length === 0
          );
        },
        'remote cleanup before stopping worker',
        30000,
      );
      await env.stopApplication();
      const final = await rollbackSnapshot(env);
      assert.deepEqual(rollbackBlockers(final), []);
      return { currentVersionRecovered: true, cleanup: true, final };
    },
  );
};
