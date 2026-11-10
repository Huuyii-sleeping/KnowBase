const assert = require('node:assert/strict');
const { before, after, beforeEach, test } = require('node:test');
const { randomUUID } = require('node:crypto');
const { fork } = require('node:child_process');
const { once } = require('node:events');
const path = require('node:path');
const { DeliveryTestEnvironment, eventually } = require('./environment.cjs');
const {
  load,
  MESSAGE_QUEUE_NAMES: queues,
  MESSAGE_ROUTING_KEYS: routes,
} = require('./runtime.cjs');

const { Document } = load('documents/entities/document.entity.js');
const { DocumentPipelinePublisher } = load(
  'documents/document-pipeline.publisher.js',
);
const { DocumentPublishService } = load(
  'documents/document-publish.service.js',
);
const { DocumentAccessService } = load(
  'authorization/document-access.service.js',
);
const { OutboxStore } = load('delivery/outbox.store.js');
const env = new DeliveryTestEnvironment();
before(async () => env.start(), { timeout: 120000 });
after(async () => env.close(), { timeout: 120000 });
beforeEach(async () => env.reset());

async function document() {
  const id = randomUUID();
  await env.source.query(
    `INSERT INTO kh_document
    (id, title, file_name, mime_type, storage_key, content_id, uploader_id, status, parse_status)
    VALUES ($1, 'Reliability fixture', 'fixture.md', 'text/markdown', $2, $3, 'admin',
    'PENDING_REVIEW', 'READY')`,
    [id, `original/${id}/fixture.md`, randomUUID()],
  );
  return id;
}

function publication(outbox) {
  const publisher = new DocumentPipelinePublisher(outbox, {
    findByContentId: async () => ({ markdown: '# Reliability fixture' }),
  });
  return new DocumentPublishService(
    env.source,
    publisher,
    new DocumentAccessService(env.source.getRepository(Document)),
  );
}

async function enqueue(runtime, documentId) {
  await runtime.outbox.enqueueStandalone(routes.SEARCH_INDEX, { documentId });
  const [row] = await env.source.query(
    "SELECT * FROM kh_pipeline_outbox WHERE body::jsonb->>'documentId' = $1",
    [documentId],
  );
  return row;
}

async function receipt(eventId, status) {
  const rows = await env.source.query(
    'SELECT * FROM kh_pipeline_receipt WHERE event_id = $1 AND status = $2',
    [eventId, status],
  );
  return rows[0];
}

async function publishRow(runtime, row) {
  await runtime.messages.publishRaw(row.routing_key, row.body, {
    messageId: row.event_id,
    attempt: row.attempt,
  });
}

test('publication and partial outbox inserts roll back together in real PostgreSQL', async () => {
  const runtime = env.runtime();
  const id = await document();
  let writes = 0;
  const failing = {
    enqueue: async (...args) => {
      if (++writes === 2) throw new Error('injected second task failure');
      return runtime.outbox.enqueue(...args);
    },
  };
  await assert.rejects(
    publication(failing).publish(id, { id: 'admin', role: 'ADMIN' }),
    /second task/,
  );
  const [state] = await env.source.query(
    'SELECT status, reviewed_by FROM kh_document WHERE id = $1',
    [id],
  );
  assert.equal(state.status, 'PENDING_REVIEW');
  assert.equal(state.reviewed_by, null);
  assert.equal(
    (await env.source.query('SELECT * FROM kh_pipeline_outbox')).length,
    0,
  );
});

test(
  'publication survives broker outage; the same relay and three consumers recover without restart',
  { timeout: 120000 },
  async () => {
    await env.broker('stop');
    try {
      const runtime = env.runtime();
      const id = await document();
      await publication(runtime.outbox).publish(id, {
        id: 'admin',
        role: 'ADMIN',
      });
      assert.equal(
        (
          await env.source.query(
            'SELECT status FROM kh_document WHERE id = $1',
            [id],
          )
        )[0].status,
        'PUBLISHED',
      );
      assert.equal(
        (
          await env.source.query(
            'SELECT * FROM kh_pipeline_outbox WHERE published_at IS NULL',
          )
        ).length,
        3,
      );
      await Promise.all(
        Object.values(queues).map((queue) =>
          runtime.consumers.subscribe(queue, (payload) =>
            env.effect(payload.documentId, queue),
          ),
        ),
      );
      runtime.relay.onModuleInit();
      await eventually(
        async () =>
          (
            await env.source.query(
              'SELECT * FROM kh_pipeline_outbox WHERE publish_attempts > 0 AND published_at IS NULL',
            )
          ).length > 0,
        'failed broker delivery retained',
      );
      await env.broker('start');
      await eventually(
        async () =>
          (
            await env.source.query(
              "SELECT * FROM kh_pipeline_receipt WHERE status = 'COMPLETED'",
            )
          ).length === 3,
        'all three consumers finish',
      );
      const effects = await env.source.query(
        'SELECT consumer, count FROM delivery_test_effect',
      );
      assert.equal(effects.length, 3);
      assert.ok(effects.every((effect) => effect.count === 1));
      await eventually(
        async () =>
          (
            await env.source.query(
              'SELECT * FROM kh_pipeline_outbox WHERE published_at IS NULL',
            )
          ).length === 0,
        'all tasks confirmed',
      );
    } finally {
      await env.broker('start');
    }
  },
);

test('a confirmed message is safely resent when its outbox marker transaction rolls back', async () => {
  const runtime = env.runtime();
  const id = randomUUID();
  const row = await enqueue(runtime, id);
  const failingSource = {
    transaction: (work) =>
      env.source.transaction((manager) =>
        work({
          query: (sql, values) => {
            if (sql.includes('SET published_at ='))
              throw new Error('injected marker failure');
            return manager.query(sql, values);
          },
        }),
      ),
  };
  await assert.rejects(
    new OutboxStore(failingSource).dispatchOne(
      (message) => publishRow(runtime, message),
      () => 100,
    ),
    /marker failure/,
  );
  assert.equal(
    (
      await env.source.query(
        'SELECT published_at FROM kh_pipeline_outbox WHERE id = $1',
        [row.id],
      )
    )[0].published_at,
    null,
  );
  await runtime.consumers.subscribe(queues.SEARCH, (payload) =>
    env.effect(payload.documentId, queues.SEARCH),
  );
  runtime.relay.onModuleInit();
  await eventually(
    () => runtime.arrivals.length >= 2,
    'original and resent event arrive',
  );
  await eventually(
    () => receipt(row.event_id, 'COMPLETED'),
    'event completion',
  );
  await eventually(
    async () =>
      (
        await env.source.query(
          'SELECT published_at FROM kh_pipeline_outbox WHERE id = $1',
          [row.id],
        )
      )[0].published_at,
    'resent marker committed',
  );
  assert.ok(
    runtime.arrivals.every((arrival) => arrival.eventId === row.event_id),
  );
  assert.equal(
    (
      await env.source.query(
        'SELECT count FROM delivery_test_effect WHERE document_id = $1',
        [id],
      )
    )[0].count,
    1,
  );
});

test('concurrent relays lock different outbox rows without blocking or double claiming', async () => {
  const runtime = env.runtime();
  await enqueue(runtime, randomUUID());
  await enqueue(runtime, randomUUID());
  const claimed = [];
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const send = async (row) => {
    claimed.push(row.event_id);
    await gate;
    await publishRow(runtime, row);
  };
  const one = runtime.outbox.dispatchOne(send, () => 100);
  const two = new OutboxStore(env.source).dispatchOne(send, () => 100);
  // Attach rejection handlers immediately; always release both transactions.
  const results = Promise.allSettled([one, two]);
  try {
    await eventually(
      () => claimed.length === 2,
      'both relays hold independent rows',
    );
  } finally {
    release();
    await results;
  }
  assert.equal(new Set(claimed).size, 2);
  assert.deepEqual(await results, [
    { status: 'fulfilled', value: 'sent' },
    { status: 'fulfilled', value: 'sent' },
  ]);
  assert.equal(
    (await env.withChannel((channel) => channel.checkQueue(queues.SEARCH)))
      .messageCount,
    2,
  );
});

test('lost acknowledgement causes redelivery while the completed receipt suppresses the side effect', async () => {
  const runtime = env.runtime();
  const id = randomUUID();
  const row = await enqueue(runtime, id);
  await publishRow(runtime, row);
  await env.withChannel(async (channel) => {
    const message = await channel.get(queues.SEARCH, { noAck: false });
    assert.ok(message);
    await runtime.processing.process(
      queues.SEARCH,
      {
        eventId: row.event_id,
        routingKey: row.routing_key,
        body: row.body,
        attempt: 0,
      },
      (payload) => env.effect(payload.documentId, queues.SEARCH),
    );
    // Close without ACK after committing the completion record.
  });
  await runtime.consumers.subscribe(queues.SEARCH, (payload) =>
    env.effect(payload.documentId, queues.SEARCH),
  );
  await eventually(
    () => runtime.arrivals.length === 1,
    'unacknowledged message redelivered',
  );
  await eventually(
    async () =>
      (await env.withChannel((channel) => channel.checkQueue(queues.SEARCH)))
        .messageCount === 0,
    'redelivery drained',
  );
  assert.equal(
    (
      await env.source.query(
        'SELECT count FROM delivery_test_effect WHERE document_id = $1',
        [id],
      )
    )[0].count,
    1,
  );
});

test(
  'SIGKILL during consumption rolls back the receipt and another process can finish the task',
  { timeout: 30000 },
  async () => {
    const runtime = env.runtime();
    const row = await enqueue(runtime, randomUUID());
    const child = fork(path.join(__dirname, 'worker.cjs'), [], {
      env: {
        ...process.env,
        DELIVERY_TEST_DATABASE_URL: env.databaseUrl,
        DELIVERY_TEST_BROKER_URL: env.brokerUrl,
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    let handling = false;
    let output = '';
    child.stdout.on('data', (data) => {
      output += data;
    });
    child.stderr.on('data', (data) => {
      output += data;
    });
    child.on('message', (message) => {
      if (message.type === 'handling') handling = true;
    });
    try {
      await publishRow(runtime, row);
      await eventually(() => {
        if (child.exitCode !== null)
          throw new Error(`Worker exited: ${output}`);
        return handling;
      }, 'child holds unacknowledged delivery');
      const exited = once(child, 'exit');
      child.kill('SIGKILL');
      await exited;
      await runtime.consumers.subscribe(queues.SEARCH, (payload) =>
        env.effect(payload.documentId, queues.SEARCH),
      );
      await eventually(
        () => receipt(row.event_id, 'COMPLETED'),
        'replacement consumer finishes',
      );
      assert.equal(
        (await env.source.query('SELECT count FROM delivery_test_effect'))[0]
          .count,
        1,
      );
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit');
        child.kill('SIGKILL');
        await exited;
      }
    }
  },
);

test(
  'scheduled retries survive worker restart, respect delay and end in a persistent dead-letter queue',
  { timeout: 120000 },
  async () => {
    let runtime = env.runtime({ retryMs: 1200 });
    const row = await enqueue(runtime, randomUUID());
    let calls = 0;
    const fail = async () => {
      calls++;
      throw new Error('injected index unavailable');
    };
    await runtime.consumers.subscribe(queues.SEARCH, fail);
    runtime.relay.onModuleInit();
    await eventually(
      () => receipt(row.event_id, 'RETRY'),
      'first retry persisted',
    );
    const [retry] = await env.source.query(
      'SELECT available_at > clock_timestamp() AS delayed FROM kh_pipeline_outbox WHERE event_id = $1 AND attempt = 1',
      [row.event_id],
    );
    assert.equal(retry.delayed, true);
    assert.equal(calls, 1);
    await runtime.close();
    env.runtimes.splice(env.runtimes.indexOf(runtime), 1);
    runtime = env.runtime({ retryMs: 1200 });
    await runtime.consumers.subscribe(queues.SEARCH, fail);
    runtime.relay.onModuleInit();
    await eventually(
      () => receipt(row.event_id, 'DEAD'),
      'three failures recorded',
    );
    assert.equal(calls, 3);
    const dead = await receipt(row.event_id, 'DEAD');
    assert.equal(dead.attempt, 2);
    assert.match(dead.last_error, /index unavailable/);
    await eventually(
      async () =>
        (
          await env.withChannel((channel) =>
            channel.checkQueue(`${queues.SEARCH}.dead`),
          )
        ).messageCount === 1,
      'dead letter published',
    );
    await runtime.close();
    env.runtimes.splice(env.runtimes.indexOf(runtime), 1);
    await env.broker('stop');
    await env.broker('start');
    await env.withChannel(async (channel) => {
      const message = await channel.get(`${queues.SEARCH}.dead`, {
        noAck: true,
      });
      assert.ok(message, 'persistent dead letter survives broker restart');
      assert.equal(message.properties.messageId, row.event_id);
      assert.equal(message.content.toString(), row.body);
      assert.equal(message.fields.routingKey, `${row.routing_key}.dead`);
    });
  },
);
