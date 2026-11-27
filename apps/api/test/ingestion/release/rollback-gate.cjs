const { MESSAGE_QUEUE_NAMES } = require('../../delivery/runtime.cjs');
function rollbackBlockers(snapshot) {
  const keys = [
    'parseActive',
    'remoteCleanupPending',
    'outboxPending',
    'receiptsIncomplete',
    'plansRunning',
    'upgradeUnfinished',
    'buildsUncertain',
    'queueReady',
    'queueConsumers',
  ];
  return keys.filter(
    (key) => !Number.isSafeInteger(snapshot[key]) || snapshot[key] !== 0,
  );
}
async function rollbackSnapshot(env) {
  const [row] = await env.source.query(`SELECT
    (SELECT count(*)::int FROM kh_document_parse_task WHERE state IN ('queued','running')) AS "parseActive",
    (SELECT count(*)::int FROM kh_document_parse_task WHERE state IN ('failed','stale','canceled') AND remote_task_id IS NOT NULL AND NOT remote_canceled) AS "remoteCleanupPending",
    (SELECT count(*)::int FROM kh_pipeline_outbox WHERE published_at IS NULL) AS "outboxPending",
    (SELECT count(*)::int FROM kh_pipeline_receipt WHERE status<>'COMPLETED') AS "receiptsIncomplete",
    (SELECT count(*)::int FROM kh_index_upgrade_plan WHERE state IN ('running','preparing')) AS "plansRunning",
    (SELECT count(*)::int FROM kh_index_upgrade_task WHERE state IN ('dispatched','running','failed','activation_unknown')) AS "upgradeUnfinished",
    (SELECT count(*)::int FROM kh_index_build_progress WHERE state IN ('running','activation_unknown')) AS "buildsUncertain"`);
  const queues = await env.withChannel(async (channel) => {
    const results = [];
    for (const name of Object.values(MESSAGE_QUEUE_NAMES)) {
      for (const queue of [name, name + '.dead'])
        results.push(await channel.checkQueue(queue));
    }
    return results;
  });
  return {
    ...row,
    queueReady: queues.reduce((n, q) => n + q.messageCount, 0),
    queueConsumers: queues.reduce((n, q) => n + q.consumerCount, 0),
    queues,
  };
}
module.exports = { rollbackBlockers, rollbackSnapshot };
