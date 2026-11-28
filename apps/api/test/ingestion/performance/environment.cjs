const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const mongoose = require('mongoose');
const { Client } = require('@elastic/elasticsearch');
const { ConfigService } = require('@nestjs/config');
const { load } = require('../runtime.cjs');
const exec = promisify(execFile);

// All writes go to this process's disposable containers, never an external DB.
class PerformanceEnvironment {
  project = `knowbase-ingestion-perf-${process.pid}`;
  async compose(...args) {
    const { stdout } = await exec(
      'docker',
      [
        'compose',
        '-p',
        this.project,
        ...['ingestion-test', 'index-test'].flatMap((name) => [
          '-f',
          path.resolve(
            __dirname,
            '../../../../../deploy',
            `docker-compose.${name}.yml`,
          ),
        ]),
        ...args,
      ],
      { timeout: 120000 },
    );
    return stdout.trim();
  }
  async start() {
    await this.compose(
      'up',
      '-d',
      '--pull',
      'never',
      '--wait',
      '--wait-timeout',
      '90',
      'mongo',
      'elasticsearch',
    );
    const mongoPort = (await this.compose('port', 'mongo', '27017'))
      .split(':')
      .pop();
    const esPort = (await this.compose('port', 'elasticsearch', '9200'))
      .split(':')
      .pop();
    this.connection = await mongoose
      .createConnection(
        `mongodb://127.0.0.1:${mongoPort}/ingestion_performance`,
      )
      .asPromise();
    this.es = new Client({ node: `http://127.0.0.1:${esPort}` });
    const schemas = load('ingestion/artifacts/artifact.schemas.js');
    this.chunkModel = this.connection.model(
      schemas.CHUNK_ARTIFACT_MODEL,
      schemas.ChunkArtifactSchema,
    );
    this.cacheModel = this.connection.model(
      schemas.EMBEDDING_CACHE_MODEL,
      schemas.EmbeddingCacheSchema,
    );
    await Promise.all([this.chunkModel.init(), this.cacheModel.init()]);
    const { ChunkArtifactStore } = load(
      'ingestion/artifacts/chunk-artifact.store.js',
    );
    const { EmbeddingCacheStore } = load(
      'ingestion/artifacts/embedding-cache.store.js',
    );
    this.artifacts = new ChunkArtifactStore(
      this.chunkModel,
      new ConfigService(),
    );
    this.cache = new EmbeddingCacheStore(this.cacheModel, new ConfigService());
    this.versions = {
      mongo: (await this.connection.db.admin().serverInfo()).version,
      elasticsearch: (await this.es.info()).version.number,
    };
  }
  async close() {
    try {
      await this.es?.close();
      await this.connection?.close();
    } finally {
      await this.compose('down', '-v', '--remove-orphans');
    }
  }
}
module.exports = { PerformanceEnvironment };
