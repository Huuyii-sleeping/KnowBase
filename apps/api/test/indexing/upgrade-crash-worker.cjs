// Disposable integration worker: stop after persisting an attempt while holding
// the shared delivery receipt transaction, then let the parent SIGKILL us.
const {
  openSource,
  createRuntime,
  load,
  MESSAGE_QUEUE_NAMES,
  MESSAGE_ROUTING_KEYS,
} = require('../delivery/runtime.cjs');
const { UpgradeExecutionStore } = load(
  'pipeline/upgrades/upgrade-execution.store.js',
);
(async () => {
  const source = await openSource(process.env.UPGRADE_TEST_DATABASE_URL);
  const runtime = createRuntime(source, process.env.UPGRADE_TEST_BROKER_URL);
  const store = new UpgradeExecutionStore(source);
  const pipeline = process.env.UPGRADE_TEST_PIPELINE;
  const key = {
    search: MESSAGE_ROUTING_KEYS.SEARCH_INDEX,
    rag: MESSAGE_ROUTING_KEYS.RAG_REBUILD,
    kg: MESSAGE_ROUTING_KEYS.KG_REBUILD,
  }[pipeline];
  await runtime.messages.consume(
    MESSAGE_QUEUE_NAMES[pipeline.toUpperCase()],
    [key],
    async (message) => {
      const attempt = await store.claim(
        message.taskId,
        message.dispatchId,
        pipeline,
      );
      process.send({ claimed: true, generation: attempt.generation });
      await new Promise(() => {});
    },
  );
  process.send({ ready: true });
})().catch((error) => {
  process.send?.({ error: error.message });
  process.exit(1);
});
