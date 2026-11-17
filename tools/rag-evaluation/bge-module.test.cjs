const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const path = require('node:path');

test('compiled Nest rerank module resolves providers and rule mode without a running model', async () => {
  const root = path.resolve(__dirname, '../..');
  const apiRequire = createRequire(path.join(root, 'apps/api/package.json'));
  apiRequire('reflect-metadata');
  const { NestFactory } = apiRequire('@nestjs/core');
  const base = path.join(root, 'apps/api/dist/src/modules/retrieval/rerank');
  const { RerankModule } = require(path.join(base, 'rerank.module.js'));
  const { HybridRerankService } = require(
    path.join(base, 'hybrid-rerank.service.js'),
  );
  const { RerankService } = require(path.join(base, 'rerank.service.js'));
  const app = await NestFactory.createApplicationContext(RerankModule, {
    logger: false,
  });
  try {
    assert.ok(app.get(RerankService));
    assert.deepEqual(
      await app.get(HybridRerankService).rerank('query', [], { topK: 5 }),
      [],
    );
  } finally {
    await app.close();
  }
});
