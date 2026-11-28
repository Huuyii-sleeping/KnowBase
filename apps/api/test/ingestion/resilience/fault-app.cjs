require('reflect-metadata');
const { NestFactory } = require('@nestjs/core');
const { ValidationPipe } = require('@nestjs/common');
const path = require('node:path');
const { FaultControl } = require('./fault-control.cjs');
const root = path.resolve(__dirname, '../../../../..');
const load = (file) => require(path.join(root, 'apps/api/dist/src', file));
async function bootstrap() {
  if (!process.send)
    throw new Error('Fault application requires a private test IPC channel');
  const app = await NestFactory.create(load('app.module.js').AppModule);
  const control = new FaultControl((message) => process.send?.(message));
  const service = (file, name) => app.get(load('modules/' + file)[name]);
  const parser = service(
    'documents/parsing/file-parser.service.js',
    'FileParserService',
  );
  const storage = service('storage/storage.service.js', 'StorageService');
  const getObject = storage.getObject.bind(storage);
  storage.getObject = async (key) => {
    const original = key.match(/^original\/([^/]+)\//);
    if (original) await control.hit('original.read', original[1]);
    return getObject(key);
  };
  const results = service(
    'documents/ingestion/parse-result.service.js',
    'ParseResultService',
  );
  const bodies = service(
    'documents/document-content.store.js',
    'DocumentContentStore',
  );
  const drafts = service(
    'documents/ingestion/parse-draft.service.js',
    'ParseDraftService',
  );
  const generations = service(
    'indexing/index-generation.store.js',
    'IndexGenerationStore',
  );
  const embedding = service(
    'pipeline/embedding/embedding.service.js',
    'EmbeddingService',
  );
  const graph = app.get('GRAPH_EXTRACTION_PROVIDER');
  // No model quality claim: deterministic vectors and graph responses isolate state correctness.
  embedding.embeddings = {
    embedDocuments: async (texts) =>
      texts.map(() => [1, ...Array(767).fill(0)]),
  };
  embedding.fingerprint = 'resilience-fixture-v1';
  graph.extract = async () => ({ entities: [], relations: [] });
  const parse = parser.parse.bind(parser);
  parser.parse = async (...args) => {
    await control.hit('parse.before', args[2]);
    const result = await parse(...args);
    await control.hit('parse.after', args[2]);
    return result;
  };
  const apply = results.apply.bind(results);
  results.apply = async (task, ...args) => {
    await control.hit('apply.before', task.document_id);
    return apply(task, ...args);
  };
  const create = bodies.create.bind(bodies);
  bodies.create = async (input) => {
    await control.hit('body.before', input.documentId);
    await create(input);
    await control.hit('body.after', input.documentId);
  };
  const readDraft = drafts.read.bind(drafts);
  drafts.read = async (id, ...args) => {
    const result = await readDraft(id, ...args);
    await control.hit('draft.read.after', id);
    return result;
  };
  const activate = generations.activate.bind(generations);
  generations.activate = async (document, pipeline, ...args) => {
    await control.hit('activate.' + pipeline + '.before', document.id);
    const result = await activate(document, pipeline, ...args);
    await control.hit('activate.' + pipeline + '.after', document.id);
    return result;
  };
  process.on('message', async (message) => {
    try {
      if (message.command === 'arm') control.arm(message.rule);
      else if (message.command === 'release') control.release(message.ruleId);
      else if (message.command !== 'stats') throw Error('Unknown test command');
      process.send?.({
        requestId: message.requestId,
        result: { counts: control.counts },
      });
    } catch (error) {
      process.send?.({ requestId: message.requestId, error: error.message });
    }
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
  process.exitCode = 1;
});
