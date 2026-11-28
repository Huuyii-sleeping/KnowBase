require('reflect-metadata');
const { NestFactory } = require('@nestjs/core');
const { ValidationPipe } = require('@nestjs/common');
const { DataSource } = require('typeorm');
const { monitorEventLoopDelay } = require('node:perf_hooks');
const path = require('node:path');
const root = path.resolve(__dirname, '../../../../..');
const load = (name) => require(path.join(root, 'apps/api/dist/src', name));
async function bootstrap() {
  if (!process.send) throw Error('Capacity fixture requires private IPC');
  const app = await NestFactory.create(load('app.module.js').AppModule);
  const embedding = app.get(
    load('modules/pipeline/embedding/embedding.service.js').EmbeddingService,
  );
  embedding.embeddings = {
    embedDocuments: async (texts) =>
      texts.map(() => [1, ...Array(767).fill(0)]),
  };
  embedding.fingerprint = 'capacity-fixture-v1';
  app.get('GRAPH_EXTRACTION_PROVIDER').extract = async () => ({
    entities: [],
    relations: [],
  });
  const source = app.get(DataSource);
  const delay = monitorEventLoopDelay({ resolution: 20 });
  delay.enable();
  process.on('message', (message) => {
    if (message.command !== 'sample') return;
    const pool = source.driver.master;
    process.send?.({
      requestId: message.requestId,
      result: {
        memory: process.memoryUsage(),
        cpuMicros: process.cpuUsage(),
        eventLoopP95Ms: Number.isFinite(delay.mean)
          ? delay.percentile(95) / 1e6
          : null,
        pool: {
          max: pool.options.max,
          total: pool.totalCount,
          idle: pool.idleCount,
          waiting: pool.waitingCount,
        },
      },
    });
    delay.reset();
  });
  app.enableShutdownHooks();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  await app.listen(process.env.PORT, '127.0.0.1');
}
bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
