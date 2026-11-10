const {
  openSource,
  createRuntime,
  MESSAGE_QUEUE_NAMES,
} = require('./runtime.cjs');

async function main() {
  const source = await openSource(process.env.DELIVERY_TEST_DATABASE_URL);
  const runtime = createRuntime(source, process.env.DELIVERY_TEST_BROKER_URL);
  await runtime.consumers.subscribe(MESSAGE_QUEUE_NAMES.SEARCH, async () => {
    process.send({ type: 'handling' });
    // Parent kills this process while its receipt transaction and delivery are open.
    await new Promise(() => {});
  });
  process.send({ type: 'ready' });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
