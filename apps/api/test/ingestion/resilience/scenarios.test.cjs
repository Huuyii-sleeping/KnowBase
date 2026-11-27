const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const { mkdir, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { ResilienceEnvironment, eventually } = require('./environment.cjs');
const { fingerprint, root, gitState } = require('../complex-quality/trace.cjs');
const output = path.resolve(
  process.env.RESILIENCE_OUTPUT || 'reports/ingestion-resilience/http-first',
);
const env = new ResilienceEnvironment();
env.events = [];
let owner, admin, report;
async function taskState(id, state) {
  let task;
  await eventually(
    async () => {
      task = await env.task(id);
      return task?.state === state;
    },
    'task ' + state,
    30000,
  );
  return task;
}
async function count(point, id) {
  return (await env.command('stats')).counts[point + ':' + id] || 0;
}
async function parseDeliveryFinished(taskId) {
  await eventually(
    async () =>
      Boolean(
        (
          await env.source.query(
            `SELECT 1 FROM kh_pipeline_receipt r JOIN kh_pipeline_outbox o ON r.event_id=o.event_id
     WHERE o.body::jsonb->>'taskId'=$1 AND r.status='COMPLETED'`,
            [taskId],
          )
        ).length,
      ),
    'parse delivery finished',
  );
}
async function remove(id) {
  const doc = await owner('GET', '/documents/' + id);
  const assets = await env.db
    .collection('document_assets')
    .distinct('objectKey', { documentId: id });
  await owner('DELETE', '/documents/' + id, undefined, 204);
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
      for (const [index, field] of [
        ['acceptance_documents', 'id'],
        ['acceptance_chunks', 'document_id'],
      ])
        if (
          (await env.elastic.indices.exists({ index })) &&
          (await env.elastic.count({ index, query: { term: { [field]: id } } }))
            .count
        )
          return false;
      const session = env.graph.session();
      try {
        const result = await session.run(
          'MATCH (n) WHERE n.documentId=$id OR (n:KnowledgeDocument AND n.id=$id) RETURN count(n) AS count',
          { id },
        );
        if (result.records[0].get('count').toNumber()) return false;
      } finally {
        await session.close();
      }
      for (const key of [doc.storageKey, ...assets]) {
        try {
          await env.objects.statObject('acceptance', key);
          return false;
        } catch (error) {
          if (!['NoSuchKey', 'NotFound'].includes(error.code)) throw error;
        }
      }
      return true;
    },
    'source cleanup',
    30000,
  );
}
async function publish(id) {
  await owner('POST', '/documents/' + id + '/submit-review', {}, 201);
  await admin('POST', '/documents/' + id + '/review', { approved: true }, 201);
}
function scenario(name, work) {
  test(name, { timeout: 90000 }, async () => {
    const entry = { name, status: 'running' };
    report.cases.push(entry);
    try {
      entry.evidence = await work();
      entry.status = 'passed';
    } catch (error) {
      entry.status = 'failed';
      entry.error = error.message;
      throw error;
    } finally {
      await writeFile(
        path.join(output, 'report.json'),
        JSON.stringify(report, null, 2) + '\n',
      );
    }
  });
}
before(
  async () => {
    await mkdir(output, { recursive: false });
    report = {
      schema: 'ingestion-resilience-http-v1',
      createdAt: new Date().toISOString(),
      git: gitState(),
      source: await fingerprint(path.join(root, 'apps/api/src')),
      compiled: await fingerprint(path.join(root, 'apps/api/dist/src')),
      tools: await fingerprint(__dirname),
      configuration: {
        parser: 'native TXT',
        embedding: 'deterministic 768d fixture',
        graph: 'empty deterministic fixture',
        leaseMs: 3000,
        parseMaxAttempts: 3,
        pipelineRetryMs: 200,
        faultControl:
          'private test process IPC, no production HTTP fault endpoints',
      },
      scope:
        'Real HTTP, production services/workers, PostgreSQL Mongo RabbitMQ RustFS ES Neo4j; native TXT parser, deterministic 768d embedding and empty graph fixture; test-only IPC service-boundary faults. No model-quality/performance claim.',
      cases: [],
    };
    await env.start(output);
    owner = await env.login();
    admin = await env.login('admin');
  },
  { timeout: 150000 },
);
after(
  async () => {
    try {
      await env.close();
      report.isolatedServicesRemoved = true;
    } finally {
      if (report) {
        report.status =
          report.cases.length === 10 &&
          report.cases.every((x) => x.status === 'passed')
            ? 'passed'
            : 'failed';
        report.httpStatuses = env.events.reduce(
          (out, x) => ((out[x.status] = (out[x.status] || 0) + 1), out),
          {},
        );
        await writeFile(
          path.join(output, 'report.json'),
          JSON.stringify(report, null, 2) + '\n',
        );
      }
    }
  },
  { timeout: 120000 },
);

const context = {
  scenario,
  env,
  owner: (...args) => owner(...args),
  admin: (...args) => admin(...args),
  count,
  taskState,
  parseDeliveryFinished,
  remove,
  publish,
};
for (const suite of ['parse-cases', 'concurrency-cases', 'index-cases'])
  require('./' + suite + '.cjs')(context);
