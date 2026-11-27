const { setTimeout: pause } = require('node:timers/promises');
const { performance } = require('node:perf_hooks');
const { distribution } = require('./metrics.cjs');
class CapacityMonitor {
  constructor(env, managementUrl, intervalMs = 500) {
    this.env = env;
    this.managementUrl = managementUrl;
    this.intervalMs = intervalMs;
    this.samples = [];
    this.errors = [];
  }
  async sample() {
    const start = performance.now();
    const outcomes = await Promise.allSettled([
      this.env.sample(),
      this.env.source.query(`SELECT count(*)::int AS connections,
        count(*) FILTER (WHERE state='active')::int AS active,
        count(*) FILTER (WHERE state='idle in transaction')::int AS idle_transaction,
        count(*) FILTER (WHERE wait_event_type='Lock')::int AS lock_wait,
        coalesce(max(extract(epoch from (clock_timestamp()-xact_start))*1000),0)::float AS oldest_transaction_ms
        FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()`),
      this.env.source.query(`SELECT
        (SELECT count(*)::int FROM kh_pipeline_outbox WHERE published_at IS NULL) AS outbox,
        (SELECT count(*)::int FROM kh_pipeline_receipt WHERE status IN ('RETRY','DEAD')) AS failed_receipts`),
      fetch(this.managementUrl + '/api/queues/%2F', {
        headers: {
          Authorization:
            'Basic ' +
            Buffer.from('delivery_test:delivery_test').toString('base64'),
        },
        signal: AbortSignal.timeout(4000),
      }).then(async (res) => {
        if (!res.ok) throw Error('RabbitMQ statistics HTTP ' + res.status);
        return res.json();
      }),
    ]);
    const values = outcomes.map((outcome, index) => {
      if (outcome.status === 'fulfilled') return outcome.value;
      this.errors.push({
        source: ['application', 'postgres', 'outbox', 'rabbitmq'][index],
        error: outcome.reason.message,
      });
      return null;
    });
    this.samples.push({
      atMs: performance.now(),
      durationMs: performance.now() - start,
      app: values[0],
      postgres: values[1]?.[0] || null,
      delivery: values[2]?.[0] || null,
      queues:
        values[3]?.map((q) => ({
          name: q.name,
          ready: q.messages_ready ?? null,
          unacked: q.messages_unacknowledged ?? null,
        })) || null,
    });
  }
  async start() {
    await this.sample();
    this.running = true;
    this.loop = (async () => {
      while (this.running) {
        await pause(this.intervalMs);
        if (this.running) await this.sample();
      }
    })();
  }
  async stop() {
    this.running = false;
    await this.loop;
    await this.sample();
    return this.summary();
  }
  summary() {
    const metric = (get) =>
      distribution(
        this.samples.map(get).filter((x) => x !== null && x !== undefined),
      );
    const apps = this.samples.flatMap((s) => (s.app ? [s.app] : []));
    const first = apps[0]?.cpuMicros,
      last = apps.at(-1)?.cpuMicros;
    return {
      intervalMs: this.intervalMs,
      count: this.samples.length,
      errors: this.errors,
      sampleDurationMs: metric((s) => s.durationMs),
      observedGapsMs: distribution(
        this.samples.slice(1).map((s, i) => s.atMs - this.samples[i].atMs),
      ),
      rssBytes: metric((s) => s.app?.memory.rss),
      heapUsedBytes: metric((s) => s.app?.memory.heapUsed),
      eventLoopP95Ms: metric((s) => s.app?.eventLoopP95Ms),
      applicationCpuMs:
        first && last
          ? (last.user + last.system - first.user - first.system) / 1000
          : null,
      poolMax: apps[0]?.pool.max ?? null,
      poolConnections: metric((s) => s.app?.pool.total),
      poolWaiting: metric((s) => s.app?.pool.waiting),
      postgresConnections: metric((s) => s.postgres?.connections),
      postgresActive: metric((s) => s.postgres?.active),
      idleInTransaction: metric((s) => s.postgres?.idle_transaction),
      lockWait: metric((s) => s.postgres?.lock_wait),
      oldestTransactionMs: metric((s) => s.postgres?.oldest_transaction_ms),
      outboxPending: metric((s) => s.delivery?.outbox),
      failedReceipts: metric((s) => s.delivery?.failed_receipts),
      rabbitReady: metric((s) =>
        s.queues && s.queues.every((q) => q.ready !== null)
          ? s.queues.reduce((n, q) => n + q.ready, 0)
          : null,
      ),
      rabbitUnacked: metric((s) =>
        s.queues && s.queues.every((q) => q.unacked !== null)
          ? s.queues.reduce((n, q) => n + q.unacked, 0)
          : null,
      ),
    };
  }
}
module.exports = { CapacityMonitor };
