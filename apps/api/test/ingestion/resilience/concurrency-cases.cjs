const assert = require('node:assert/strict');
const { eventually } = require('./environment.cjs');
module.exports = function register({
  scenario,
  env,
  owner,
  taskState,
  parseDeliveryFinished,
  remove,
}) {
  scenario(
    'manual edit while native parser is paused cannot be overwritten by late output',
    async () => {
      await env.arm('late-parse', 'parse.after');
      const doc = await env.upload(owner, 'edit-during-parse');
      await env.paused('late-parse');
      const edited = await owner('PUT', '/documents/' + doc.id + '/content', {
        markdown: 'Manual revision must survive',
      });
      await env.release('late-parse');
      const task = await taskState(doc.id, 'stale');
      await parseDeliveryFinished(task.id);
      const current = await owner('GET', '/documents/' + doc.id);
      assert.equal(current.contentId, edited.contentId);
      assert.equal(current.version, 2);
      assert.equal(current.content.markdown, 'Manual revision must survive');
      await remove(doc.id);
      return {
        version: 2,
        manualRevisionPreserved: true,
        staleTask: true,
        cleanup: true,
      };
    },
  );

  scenario(
    'candidate adoption rechecks revision after a concurrent edit invalidates its read snapshot',
    async () => {
      const doc = await env.upload(owner, 'adoption-race');
      await env.ready(owner, doc.id);
      await owner('POST', '/documents/' + doc.id + '/reparse', {}, 202);
      const task = await taskState(doc.id, 'needs_review');
      await env.arm('adoption-read', 'draft.read.after', 'pause', {
        documentId: doc.id,
      });
      const adoption = owner(
        'POST',
        '/documents/' + doc.id + '/parse-review',
        {
          taskId: task.id,
          accept: true,
          acknowledgeIssues: true,
          note: 'Review snapshot',
        },
        409,
      );
      await env.paused('adoption-read');
      const edited = await owner('PUT', '/documents/' + doc.id + '/content', {
        markdown: 'New manual content',
      });
      await env.release('adoption-read');
      await adoption;
      const current = await owner('GET', '/documents/' + doc.id);
      assert.equal(current.contentId, edited.contentId);
      assert.equal(current.content.markdown, 'New manual content');
      assert.equal(current.version, 2);
      await remove(doc.id);
      return {
        adoptionHttpStatus: 409,
        manualRevisionPreserved: true,
        cleanup: true,
      };
    },
  );
  scenario(
    'deletion during paused parsing leaves no body or original after late worker finishes',
    async () => {
      await env.arm('delete-parse', 'parse.after');
      const doc = await env.upload(owner, 'delete-during-parse');
      await env.paused('delete-parse');
      const task = await env.task(doc.id);
      await owner('DELETE', '/documents/' + doc.id, undefined, 204);
      await env.release('delete-parse');
      await parseDeliveryFinished(task.id);
      await owner('GET', '/documents/' + doc.id, undefined, 404);
      await eventually(
        async () =>
          !(await env.db
            .collection('document_content')
            .countDocuments({ documentId: doc.id })),
        'no late parse body',
      );
      const tasks = await env.task(doc.id);
      assert.ok(['stale', 'canceled'].includes(tasks.state));
      await eventually(async () => {
        try {
          await env.objects.statObject('acceptance', doc.storageKey);
          return false;
        } catch (error) {
          if (['NoSuchKey', 'NotFound'].includes(error.code)) return true;
          throw error;
        }
      }, 'original removed after late parse');
      const heads = await env.source.query(
        'SELECT * FROM kh_index_head WHERE document_id=$1',
        [doc.id],
      );
      assert.equal(heads.length, 3);
      assert.ok(heads.every((h) => h.deleted && h.generation === null));
      return {
        lateWorkerFinished: true,
        noLateBody: true,
        originalRemoved: true,
        tombstonedPipelines: 3,
        cleanup: true,
      };
    },
  );
};
