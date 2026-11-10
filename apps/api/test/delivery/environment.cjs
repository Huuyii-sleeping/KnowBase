const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const net = require('node:net');
const amqp = require('amqplib');
const {
  openSource,
  createRuntime,
  MESSAGE_QUEUE_NAMES,
} = require('./runtime.cjs');

const exec = promisify(execFile);
const root = path.resolve(__dirname, '../../../..');

async function eventually(check, label, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      if (await check()) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out: ${label}`, { cause: lastError });
}

class DeliveryTestEnvironment {
  project = `knowbase-delivery-test-${process.pid}`;
  runtimes = [];
  composeEnvironment = { ...process.env };
  composeFiles = ['docker-compose.delivery-test.yml'];
  async compose(...args) {
    const { stdout } = await exec(
      'docker',
      [
        'compose',
        '-p',
        this.project,
        ...this.composeFiles.flatMap((file) => [
          '-f',
          path.join(root, 'deploy', file),
        ]),
        ...args,
      ],
      { timeout: 120000, env: this.composeEnvironment },
    );
    return stdout.trim();
  }

  async start() {
    // Bind both ports first so they are distinct; pin them across broker restarts.
    const servers = [net.createServer(), net.createServer()];
    try {
      for (const server of servers) {
        await new Promise((resolve, reject) => {
          server.once('error', reject);
          server.listen(0, '127.0.0.1', resolve);
        });
      }
      this.composeEnvironment.DELIVERY_TEST_POSTGRES_PORT = String(
        servers[0].address().port,
      );
      this.composeEnvironment.DELIVERY_TEST_RABBITMQ_PORT = String(
        servers[1].address().port,
      );
    } finally {
      await Promise.all(
        servers.map(
          (server) => new Promise((resolve) => server.close(resolve)),
        ),
      );
    }
    await this.compose(
      'up',
      '-d',
      '--pull',
      process.env.DELIVERY_TEST_PULL_POLICY || 'missing',
      '--wait',
      '--wait-timeout',
      '90',
    );
    const pgPort = (await this.compose('port', 'postgres', '5432'))
      .split(':')
      .pop();
    const mqPort = (await this.compose('port', 'rabbitmq', '5672'))
      .split(':')
      .pop();
    this.databaseUrl = `postgresql://delivery_test:delivery_test@127.0.0.1:${pgPort}/delivery_test`;
    this.brokerUrl = `amqp://delivery_test:delivery_test@127.0.0.1:${mqPort}`;
    await this.waitForBroker();
    // Exercise the documented psql migration entry point, including its relative include.
    await this.compose(
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      'delivery_test',
      '-d',
      'delivery_test',
      '-v',
      'ON_ERROR_STOP=1',
      '-f',
      '/schema/init/001_document_schema.sql',
      '-f',
      '/schema/migrations/004_pipeline_delivery.sql',
      '-f',
      '/schema/migrations/005_index_generations.sql',
      '-f',
      '/schema/migrations/005_index_generations.sql',
      '-f',
      '/schema/migrations/004_pipeline_delivery.sql',
    );
    this.source = await openSource(this.databaseUrl);
    await this.source.query(`CREATE TABLE delivery_test_effect (
      document_id UUID NOT NULL, consumer TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (document_id, consumer))`);
  }

  runtime(options) {
    const runtime = createRuntime(this.source, this.brokerUrl, options);
    this.runtimes.push(runtime);
    return runtime;
  }

  async broker(action) {
    if (action === 'stop') await this.compose('stop', '-t', '1', 'rabbitmq');
    else {
      await this.compose(
        'up',
        '-d',
        '--pull',
        process.env.DELIVERY_TEST_PULL_POLICY || 'missing',
        '--wait',
        '--wait-timeout',
        '90',
        'rabbitmq',
      );
      await this.waitForBroker();
    }
  }

  async waitForBroker() {
    // A running Erlang node is not proof that the AMQP listener accepts clients.
    await eventually(
      () => this.withChannel(async () => true),
      'AMQP handshake ready',
    );
  }

  async withChannel(work) {
    const connection = await amqp.connect(this.brokerUrl, { timeout: 1000 });
    connection.on('error', () => {});
    try {
      const channel = await connection.createChannel();
      channel.on('error', () => {});
      return await work(channel);
    } finally {
      await connection.close().catch(() => {});
    }
  }

  async reset() {
    for (const runtime of this.runtimes.splice(0)) await runtime.close();
    await this.withChannel(async (channel) => {
      for (const queue of Object.values(MESSAGE_QUEUE_NAMES)) {
        await channel.assertQueue(queue, { durable: true });
        await channel.purgeQueue(queue);
        await channel.assertQueue(`${queue}.dead`, { durable: true });
        await channel.purgeQueue(`${queue}.dead`);
      }
    });
    await this.source.query(
      'TRUNCATE kh_pipeline_receipt, kh_pipeline_outbox, kh_index_head, kh_document, delivery_test_effect',
    );
  }

  async effect(documentId, consumer) {
    await this.source.query(
      `INSERT INTO delivery_test_effect (document_id, consumer)
      VALUES ($1, $2) ON CONFLICT (document_id, consumer)
      DO UPDATE SET count = delivery_test_effect.count + 1`,
      [documentId, consumer],
    );
  }

  async close() {
    try {
      for (const runtime of this.runtimes.splice(0)) await runtime.close();
    } finally {
      try {
        if (this.source?.isInitialized) await this.source.destroy();
      } finally {
        await this.compose('down', '-v', '--remove-orphans');
      }
    }
  }
}

module.exports = { DeliveryTestEnvironment, eventually };
