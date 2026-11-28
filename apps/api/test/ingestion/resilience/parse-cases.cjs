const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { eventually } = require('./environment.cjs');
module.exports = function register({
  scenario,
  env,
  owner,
  count,
  taskState,
  remove,
}) {
  scenario(
    'completed native parse ignores a duplicate command with a new delivery identity',
    async () => {
      const doc = await env.upload(owner, 'duplicate');
      await env.ready(owner, doc.id);
      const task = await taskState(doc.id, 'completed');
      const runtime = env.runtime();
      const eventId = randomUUID();
      await runtime.messages.publishRaw(
        'document.parse',
        JSON.stringify({ type: 'DOCUMENT_PARSE', taskId: task.id }),
        { messageId: eventId, attempt: 0 },
      );
      await eventually(
        async () =>
          Boolean(
            (
              await env.source.query(
                "SELECT 1 FROM kh_pipeline_receipt WHERE event_id=$1 AND status='COMPLETED'",
                [eventId],
              )
            ).length,
          ),
        'duplicate receipt',
      );
      assert.equal(await count('parse.before', doc.id), 1);
      assert.equal(await count('original.read', doc.id), 1);
      assert.equal((await env.task(doc.id)).attempts, 1);
      await remove(doc.id);
      return {
        parses: 1,
        attempts: 1,
        duplicateDeliveryCompleted: true,
        cleanup: true,
      };
    },
  );

  scenario(
    'failure after real Mongo body write removes abandoned body before retry adoption',
    async () => {
      await env.arm('body-write-failed', 'body.after', 'throw');
      const doc = await env.upload(owner, 'body-write-failure');
      const adopted = await env.ready(owner, doc.id);
      const task = await taskState(doc.id, 'completed');
      assert.equal(task.attempts, 2);
      const bodies = await env.db
        .collection('document_content')
        .find({ documentId: doc.id })
        .toArray();
      assert.equal(bodies.length, 1);
      assert.equal(bodies[0].contentId, adopted.contentId);
      assert.equal(
        task.content_ids.filter((id) => id !== adopted.contentId).length,
        1,
      );
      for (const old of task.content_ids)
        if (old !== adopted.contentId)
          assert.equal(
            await env.db
              .collection('document_evidence')
              .countDocuments({ contentId: old }),
            0,
          );
      await remove(doc.id);
      return {
        attempts: 2,
        remainingBodies: 1,
        abandonedBodyRemoved: true,
        cleanup: true,
      };
    },
  );

  scenario(
    'apply failure reuses durable checkpoint without re-reading or re-parsing source',
    async () => {
      await env.arm('apply-failure', 'apply.before', 'throw');
      const doc = await env.upload(owner, 'checkpoint-retry');
      const adopted = await env.ready(owner, doc.id),
        task = await taskState(doc.id, 'completed');
      assert.equal(task.attempts, 2);
      assert.equal(task.checkpoint_content_id, adopted.contentId);
      assert.equal(await count('parse.before', doc.id), 1);
      assert.equal(await count('original.read', doc.id), 1);
      await remove(doc.id);
      return {
        attempts: 2,
        parses: 1,
        originalReads: 1,
        checkpointReused: true,
        cleanup: true,
      };
    },
  );

  scenario(
    'three parse exceptions exhaust retry budget without publishing or persisting a body',
    async () => {
      await env.arm('parse-timeout', 'parse.before', 'throw', { times: 3 });
      const doc = await env.upload(owner, 'parse-timeout');
      const task = await taskState(doc.id, 'failed');
      assert.equal(task.attempts, 3);
      const failed = await owner('GET', '/documents/' + doc.id);
      assert.equal(failed.parseStatus, 'FAILED');
      assert.equal(failed.status, 'DRAFT');
      assert.equal(failed.content, undefined);
      assert.equal(
        await env.db
          .collection('document_content')
          .countDocuments({ documentId: doc.id }),
        0,
      );
      await owner('POST', '/documents/' + doc.id + '/submit-review', {}, 422);
      await remove(doc.id);
      return {
        attempts: 3,
        noAdoptedBody: true,
        publicationRejected: true,
        cleanup: true,
      };
    },
  );

  scenario(
    'SIGKILL after checkpoint resumes on restart without another parser execution',
    async () => {
      await env.arm('kill-checkpoint', 'apply.before');
      const doc = await env.upload(owner, 'crash-resume');
      await env.paused('kill-checkpoint');
      const task = await env.task(doc.id);
      assert.ok(task.checkpoint_content_id);
      assert.equal(await count('parse.before', doc.id), 1);
      assert.equal(await count('original.read', doc.id), 1);
      await env.stopApplication('SIGKILL');
      await eventually(
        () => Date.now() > new Date(task.lease_until).getTime(),
        'lease expiry',
        10000,
      );
      await env.launchApplication();
      const adopted = await env.ready(owner, doc.id);
      const resumed = await taskState(doc.id, 'completed');
      assert.equal(resumed.attempts, 2);
      assert.equal(adopted.contentId, task.checkpoint_content_id);
      assert.equal(await count('parse.before', doc.id), 0);
      assert.equal(await count('original.read', doc.id), 0);
      await remove(doc.id);
      return {
        signal: 'SIGKILL',
        attempts: 2,
        newProcessParses: 0,
        newProcessOriginalReads: 0,
        checkpointReused: true,
        cleanup: true,
      };
    },
  );
};
