const assert = require('node:assert/strict');
const path = require('node:path');
const { readFile } = require('node:fs/promises');
const { root } = require('../complex-quality/trace.cjs');
const { eventually } = require('../acceptance/environment.cjs');
const { drain } = require('../capacity/workload.cjs');
const { upload, publish, readback, upgrade, sha } = require('./workflow.cjs');
module.exports = async ({ env, docs, scenario, currentEntry }) => {
  await scenario(
    'old binary creates published document and current generation',
    async () => {
      const doc = await upload(
        env,
        Buffer.from(
          'Release sentinel. Approved limit is 731 units.\n\nOwner remains Research.',
        ),
        'release-legacy.txt',
      );
      docs.push(doc);
      await publish(env, doc);
      return {
        documentId: doc.id,
        bodySha256: doc.bodySha256,
        ...(await readback(env, doc)),
      };
    },
  );
  await drain(env);
  await env.restart(currentEntry, {
    RAG_CHUNK_SIZE: '256',
    RAG_CHUNK_OVERLAP: '20',
  });
  await scenario(
    'new binary reads old data and upgrades one canary',
    async () => {
      await readback(env, docs[0]);
      return upgrade(env, [docs[0]]);
    },
  );
  await scenario(
    'real MinerU OCR retains original, body, evidence and indexes',
    async () => {
      const data = await readFile(
        path.join(
          root,
          'reports/ingestion-complex/ocr-table-new-v2/ocr-table-middle-empty.pdf',
        ),
      );
      const doc = await upload(env, data, 'release-scan.pdf');
      docs.push(doc);
      assert.ok(doc.markdown.includes('-8.75'));
      assert.ok(doc.markdown.includes('未测'));
      await publish(env, doc);
      await readback(env, doc);
      const body = await env.db
        .collection('document_content')
        .findOne({ contentId: doc.contentId });
      assert.ok(body.assets.length);
      assert.ok(
        await env.db
          .collection('document_evidence')
          .countDocuments({ contentId: doc.contentId }),
      );
      return {
        documentId: doc.id,
        sourceSha256: doc.sourceSha256,
        bodySha256: doc.bodySha256,
        assets: body.assets.length,
        parser: body.parser,
        provenance: body.provenance,
      };
    },
  );
  await scenario('expand canary to two documents without replacing body', () =>
    upgrade(env, docs),
  );
  let draft;
  await scenario(
    'reparse candidate remains independent before rollback',
    async () => {
      const owner = await env.login('owner'),
        doc = docs[1];
      const task = await owner(
        'POST',
        '/documents/' + doc.id + '/reparse',
        {},
        202,
      );
      await eventually(
        async () => {
          const current = await owner('GET', '/documents/' + doc.id);
          return (
            current.ingestion?.task?.id === task.taskId &&
            current.ingestion.task.state === 'needs_review'
          );
        },
        'release candidate',
        300000,
      );
      const candidate = await owner(
        'GET',
        '/documents/' + doc.id + '/parse-drafts/' + task.taskId,
      );
      draft = {
        documentId: doc.id,
        taskId: task.taskId,
        bodySha256: sha(candidate.markdown),
        assets: candidate.assets.map((a) => a.objectKey),
      };
      await readback(env, doc);
      return { ...draft, currentPublishedBodyPreserved: true };
    },
  );

  return draft;
};
