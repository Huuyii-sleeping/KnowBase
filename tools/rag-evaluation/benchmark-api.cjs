// Full application and real retrieval providers, with only retrieval workers
// started. KG extraction is outside this benchmark and must not contend for GPU.
const { createRequire } = require('node:module');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const apiRequire = createRequire(path.join(root, 'apps/api/package.json'));
const { NestFactory } = apiRequire('@nestjs/core');
const { ValidationPipe } = apiRequire('@nestjs/common');
const modules = path.join(root, 'apps/api/dist/src');
const { AppModule } = require(path.join(modules, 'app.module.js'));
const { SearchPipelineConsumer } = require(
  path.join(modules, 'modules/pipeline/search/search-pipeline.consumer.js'),
);
const { RagPipelineConsumer } = require(
  path.join(modules, 'modules/pipeline/rag/rag-pipeline.consumer.js'),
);

(async () => {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  await app.init();
  await app.get(SearchPipelineConsumer).consume();
  await app.get(RagPipelineConsumer).consume();
  const { installRecallHandler } = require('./recall-ipc.cjs');
  installRecallHandler(
    process,
    app.get(
      require(path.join(modules, 'modules/rag/rag-query.service.js'))
        .RagQueryService,
    ),
    app.get(
      require(path.join(modules, 'modules/retrieval/rerank/rerank.service.js'))
        .RerankService,
    ),
    require(path.join(modules, 'modules/search/hybrid-candidates.js'))
      .mergeChunkCandidates,
  );
  await app.listen(0, '127.0.0.1');
  process.send({ port: app.getHttpServer().address().port });
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
