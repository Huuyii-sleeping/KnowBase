const { spawn } = require('node:child_process');
const { createWriteStream } = require('node:fs');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const net = require('node:net');
const { hash } = require('bcryptjs');
const {
  DeliveryTestEnvironment,
  eventually,
} = require('../../delivery/environment.cjs');
const { MongoClient } = require('mongoose').mongo;
const { Client } = require('@elastic/elasticsearch');
const { Client: ObjectClient } = require('minio');
const neo4jDriver = require('neo4j-driver');
const root = path.resolve(__dirname, '../../../../..');
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
class AcceptanceEnvironment extends DeliveryTestEnvironment {
  project = `knowbase-acceptance-${randomUUID().slice(0, 8)}`;
  composeFiles = [
    'docker-compose.delivery-test.yml',
    'docker-compose.ingestion-test.yml',
    'docker-compose.index-test.yml',
    'docker-compose.ingestion-acceptance-test.yml',
  ];
  async start(output) {
    await super.start();
    const port = async (service, internal) =>
      Number((await this.compose('port', service, internal)).split(':').pop());
    const [mongo, object, elastic, neo4j] = await Promise.all([
      port('mongo', '27017'),
      port('object-storage', '9000'),
      port('elasticsearch', '9200'),
      port('neo4j', '7687'),
    ]);
    this.mongo = await new MongoClient(
      `mongodb://127.0.0.1:${mongo}`,
    ).connect();
    this.db = this.mongo.db('acceptance');
    this.elastic = new Client({ node: `http://127.0.0.1:${elastic}` });
    this.graph = neo4jDriver.driver(
      `bolt://127.0.0.1:${neo4j}`,
      neo4jDriver.auth.basic('neo4j', 'index-test-password'),
    );
    this.objects = new ObjectClient({
      endPoint: '127.0.0.1',
      port: object,
      useSSL: false,
      accessKey: 'ingestion-test',
      secretKey: 'ingestion-test-password',
    });
    this.password = randomUUID();
    const passwordHash = await hash(this.password, 4);
    for (const [username, role] of [
      ['acceptance-admin', 'ADMIN'],
      ['acceptance-owner', 'MEMBER'],
      ['acceptance-reader', 'MEMBER'],
      ['acceptance-outsider', 'MEMBER'],
    ])
      await this.source.query(
        'INSERT INTO kh_user(username,display_name,password_hash,role,team) VALUES ($1,$1,$2,$3,$4)',
        [
          username,
          passwordHash,
          role,
          username === 'acceptance-outsider' ? 'other' : 'quality',
        ],
      );
    const apiPort = await freePort();
    this.baseUrl = `http://127.0.0.1:${apiPort}`;
    this.log = createWriteStream(path.join(output, 'api.log'));
    this.api = spawn(
      process.execPath,
      [path.join(root, 'apps/api/dist/src/main.js')],
      {
        cwd: root,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PORT: String(apiPort),
          POSTGRES_HOST: '127.0.0.1',
          POSTGRES_PORT: new URL(this.databaseUrl).port,
          POSTGRES_DB: 'delivery_test',
          POSTGRES_USER: 'delivery_test',
          POSTGRES_PASSWORD: 'delivery_test',
          MONGODB_URI: `mongodb://127.0.0.1:${mongo}/acceptance`,
          RABBITMQ_URL: this.brokerUrl,
          JWT_SECRET: randomUUID() + randomUUID(),
          RUSTFS_ENDPOINT: '127.0.0.1',
          RUSTFS_PORT: String(object),
          RUSTFS_USE_SSL: 'false',
          RUSTFS_ACCESS_KEY: 'ingestion-test',
          RUSTFS_SECRET_KEY: 'ingestion-test-password',
          RUSTFS_BUCKET: 'acceptance',
          PUBLIC_API_BASE_URL: this.baseUrl + '/api/v1',
          ELASTICSEARCH_NODE: `http://127.0.0.1:${elastic}`,
          ELASTICSEARCH_API_KEY: '',
          ELASTICSEARCH_DOCUMENT_INDEX: 'acceptance_documents',
          ELASTICSEARCH_CHUNK_INDEX: 'acceptance_chunks',
          NEO4J_URI: `bolt://127.0.0.1:${neo4j}`,
          NEO4J_USER: 'neo4j',
          NEO4J_PASSWORD: 'index-test-password',
          DOCUMENT_PARSER: 'mineru',
          MINERU_BASE_URL: process.env.MINERU_BASE_URL,
          MINERU_API_KEY: '',
          MINERU_TIER: 'flash',
          MINERU_TIMEOUT_MS: '300000',
          MINERU_POLL_MS: '500',
          IMAGE_ANALYSIS_MODE: 'ocr',
          VISION_API_KEY: '',
          VISION_BASE_URL: '',
          VISION_MODEL: '',
          INGESTION_ASYNC_ENABLED: 'true',
          PIPELINE_WORKERS_ENABLED: 'true',
          OUTBOX_RELAY_ENABLED: 'true',
          OUTBOX_POLL_INTERVAL_MS: '100',
          OUTBOX_BATCH_SIZE: '10',
          LANGFUSE_ENABLED: 'false',
          EMBEDDING_PROVIDER: 'ollama',
          OLLAMA_BASE_URL: 'http://127.0.0.1:11434',
          OLLAMA_EMBEDDING_MODEL: 'nomic-embed-text:latest',
          EMBEDDING_MODEL_REVISION: process.env.QUALITY_EMBEDDING_REVISION,
          RAG_EMBEDDING_DIMENSIONS: '768',
          RAG_CHUNK_SIZE: '1000',
          RAG_CHUNK_OVERLAP: '150',
          OLLAMA_KG_MODEL: 'qwen2.5:0.5b',
          OLLAMA_KG_MODEL_REVISION: process.env.QUALITY_KG_REVISION,
          INDEX_GENERATION_GC_ENABLED: 'false',
        },
      },
    );
    this.api.stdout.pipe(this.log);
    this.api.stderr.pipe(this.log);
    await eventually(
      async () => {
        if (this.api.exitCode !== null)
          throw new Error('Acceptance API exited; see isolated api.log');
        return (await fetch(this.baseUrl + '/api/v1/health')).ok;
      },
      'acceptance HTTP ready',
      60000,
    );
  }
  async close() {
    if (
      this.api &&
      this.api.exitCode === null &&
      this.api.signalCode === null
    ) {
      this.api.kill('SIGTERM');
      await Promise.race([
        new Promise((resolve) => this.api.once('exit', resolve)),
        new Promise((resolve) => setTimeout(resolve, 10000)),
      ]);
      if (this.api.exitCode === null && this.api.signalCode === null) {
        this.api.kill('SIGKILL');
        await new Promise((resolve) => this.api.once('exit', resolve));
      }
    }
    this.log?.end();
    const {
      cleanupAll,
    } = require('../complex-quality/delivery-environment.cjs');
    await cleanupAll([
      () => this.elastic?.close(),
      () => this.graph?.close(),
      () => this.mongo?.close(),
      () => super.close(),
    ]);
  }
}
module.exports = { AcceptanceEnvironment, eventually, root };
