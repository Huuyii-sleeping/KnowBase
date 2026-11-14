const fs = require('node:fs');
const path = require('node:path');
const { fork } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const {
  DeliveryTestEnvironment,
} = require('../../apps/api/test/delivery/environment.cjs');

const root = path.resolve(__dirname, '../..');

class RetrievalBenchmarkEnvironment extends DeliveryTestEnvironment {
  constructor(forkApi = fork) {
    super();
    this.forkApi = forkApi;
    this.project = `knowbase-retrieval-${process.pid}`;
    this.composeFiles = [
      'docker-compose.delivery-test.yml',
      'docker-compose.index-test.yml',
      'docker-compose.retrieval-test.yml',
    ];
  }

  async launchApi(
    outputDirectory,
    ollamaUrl,
    encoding = 'plain',
    lexical = 'standard',
    context = 'body',
    keywordPolicy = 'combined',
    bodySlots = 2,
  ) {
    const port = async (service, inner) =>
      (await this.compose('port', service, inner)).split(':').pop();
    const [mongoPort, storagePort, elasticPort, neo4jPort] = await Promise.all([
      port('mongodb', '27017'),
      port('rustfs', '9000'),
      port('elasticsearch', '9200'),
      port('neo4j', '7687'),
    ]);
    const postgres = new URL(this.databaseUrl);
    this.elasticsearchUrl = `http://127.0.0.1:${elasticPort}`;
    const environment = {
      ...process.env,
      JWT_SECRET: randomBytes(32).toString('hex'),
      POSTGRES_HOST: postgres.hostname,
      POSTGRES_PORT: postgres.port,
      POSTGRES_DB: postgres.pathname.slice(1),
      POSTGRES_USER: postgres.username,
      POSTGRES_PASSWORD: postgres.password,
      MONGODB_URI: `mongodb://delivery_test:delivery_test@127.0.0.1:${mongoPort}/benchmark?authSource=admin`,
      RUSTFS_ENDPOINT: '127.0.0.1',
      RUSTFS_PORT: storagePort,
      RUSTFS_USE_SSL: 'false',
      RUSTFS_ACCESS_KEY: 'delivery_test',
      RUSTFS_SECRET_KEY: 'delivery_test_secret',
      RUSTFS_BUCKET: 'benchmark',
      RABBITMQ_URL: this.brokerUrl,
      PIPELINE_WORKERS_ENABLED: 'false',
      OUTBOX_RELAY_ENABLED: 'true',
      ELASTICSEARCH_NODE: this.elasticsearchUrl,
      ELASTICSEARCH_DOCUMENT_INDEX: 'kh_document',
      ELASTICSEARCH_CHUNK_INDEX: 'kh_chunk',
      RAG_CHUNK_SIZE: '1000',
      RAG_CHUNK_OVERLAP: '150',
      RAG_EMBEDDING_DIMENSIONS: '768',
      RAG_KEYWORD_ANALYZER: lexical,
      RAG_RETRIEVAL_CONTEXT: context,
      RAG_KEYWORD_POLICY: keywordPolicy,
      RAG_KEYWORD_BODY_SLOTS: String(bodySlots),
      EMBEDDING_PROVIDER: 'ollama',
      OLLAMA_BASE_URL: ollamaUrl,
      OLLAMA_EMBEDDING_MODEL: 'nomic-embed-text',
      EMBEDDING_DOCUMENT_PREFIX:
        encoding === 'nomic-task' ? 'search_document: ' : '',
      EMBEDDING_QUERY_PREFIX: encoding === 'nomic-task' ? 'search_query: ' : '',
      NEO4J_URI: `bolt://127.0.0.1:${neo4jPort}`,
      NEO4J_USER: 'neo4j',
      NEO4J_PASSWORD: 'index-test-password',
      LANGFUSE_ENABLED: 'false',
    };
    const log = fs.openSync(path.join(outputDirectory, 'api.log'), 'w');
    try {
      this.api = this.forkApi(path.join(__dirname, 'benchmark-api.cjs'), [], {
        // ConfigModule resolves .env from cwd; keep it away from the user's API checkout.
        cwd: outputDirectory,
        env: environment,
        stdio: ['ignore', log, log, 'ipc'],
      });
    } finally {
      fs.closeSync(log);
    }
    const apiPort = await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () =>
          reject(new Error('Benchmark API startup timed out; inspect api.log')),
        60000,
      );
      const exit = () => {
        clearTimeout(timeout);
        reject(
          new Error('Benchmark API exited during startup; inspect api.log'),
        );
      };
      this.api.once('exit', exit);
      this.api.once('message', (message) => {
        clearTimeout(timeout);
        this.api.removeListener('exit', exit);
        if (
          !Number.isInteger(message.port) ||
          message.port <= 0 ||
          message.port > 65535
        )
          reject(new Error('Invalid benchmark API port'));
        else resolve(message.port);
      });
    });
    this.baseUrl = `http://127.0.0.1:${apiPort}/api/v1`;
  }

  async close() {
    try {
      if (
        this.api &&
        this.api.exitCode === null &&
        this.api.signalCode === null
      ) {
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            try {
              this.api.kill('SIGKILL');
            } catch (error) {
              reject(error);
            }
          }, 10000);
          const exit = () => {
            clearTimeout(timeout);
            resolve();
          };
          this.api.once('exit', exit);
          try {
            this.api.kill('SIGTERM');
          } catch (error) {
            clearTimeout(timeout);
            this.api.removeListener('exit', exit);
            reject(error);
          }
        });
      }
    } finally {
      await super.close();
    }
  }
}

module.exports = { RetrievalBenchmarkEnvironment };
