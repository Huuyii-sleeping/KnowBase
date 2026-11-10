const path = require('node:path');
const { ConfigService } = require('@nestjs/config');
const { DataSource } = require('typeorm');

const compiled = path.resolve(__dirname, '../../dist/src/modules');
const load = (module) => require(path.join(compiled, module));
const { Document } = load('documents/entities/document.entity.js');
const { OutboxStore } = load('delivery/outbox.store.js');
const { DeliveryReceiptStore } = load('delivery/delivery-receipt.store.js');
const { MessageProcessingService } = load(
  'delivery/message-processing.service.js',
);
const { RabbitMqConnectionService } = load(
  'message-queue/rabbitmq-connection.service.js',
);
const { RabbitMqTopologyService } = load(
  'message-queue/rabbitmq-topology.service.js',
);
const { RabbitMqPublisherService } = load(
  'message-queue/rabbitmq-publisher.service.js',
);
const { RabbitMqConsumerService } = load(
  'message-queue/rabbitmq-consumer.service.js',
);
const { MessageQueueService } = load('message-queue/message-queue.service.js');
const { OutboxRelayService } = load('message-queue/outbox-relay.service.js');
const { MESSAGE_QUEUE_NAMES, MESSAGE_ROUTING_KEYS } = load(
  'message-queue/message-queue.constants.js',
);

async function openSource(url) {
  return new DataSource({
    type: 'postgres',
    url,
    entities: [Document],
  }).initialize();
}

function createRuntime(source, brokerUrl, options = {}) {
  const config = new ConfigService({
    RABBITMQ_URL: brokerUrl,
    RABBITMQ_CONNECT_TIMEOUT_MS: 1000,
    RABBITMQ_CONFIRM_TIMEOUT_MS: 2000,
    RABBITMQ_RECONNECT_INTERVAL_MS: 200,
    RABBITMQ_PREFETCH: 1,
    OUTBOX_RELAY_ENABLED: true,
    OUTBOX_POLL_INTERVAL_MS: 100,
    OUTBOX_BATCH_SIZE: 20,
    PIPELINE_MAX_ATTEMPTS: 3,
    PIPELINE_RETRY_DELAY_MS: options.retryMs ?? 200,
  });
  const outbox = new OutboxStore(source);
  const receipts = new DeliveryReceiptStore(source);
  const processing = new MessageProcessingService(config, receipts, outbox);
  const connection = new RabbitMqConnectionService(config);
  const topology = new RabbitMqTopologyService();
  const publisher = new RabbitMqPublisherService(config, connection, topology);
  const arrivals = [];
  const observer = {
    async process(queue, delivery, handler) {
      arrivals.push(delivery);
      await processing.process(queue, delivery, handler);
    },
  };
  const consumers = new RabbitMqConsumerService(
    config,
    connection,
    topology,
    observer,
  );
  const messages = new MessageQueueService(publisher, consumers);
  const relay = new OutboxRelayService(config, outbox, messages);
  return {
    outbox,
    receipts,
    processing,
    publisher,
    consumers,
    relay,
    messages,
    arrivals,
    async close() {
      await relay.onModuleDestroy();
      await consumers.onModuleDestroy();
      await publisher.onModuleDestroy();
      await connection.onModuleDestroy();
    },
  };
}

module.exports = {
  load,
  openSource,
  createRuntime,
  MESSAGE_QUEUE_NAMES,
  MESSAGE_ROUTING_KEYS,
};
