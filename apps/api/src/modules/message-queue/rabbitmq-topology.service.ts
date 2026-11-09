import { Injectable } from '@nestjs/common';
import type { Channel } from 'amqplib';
import {
  MESSAGE_QUEUE_EXCHANGE,
  MESSAGE_QUEUE_NAMES,
  MESSAGE_ROUTING_KEYS,
} from './message-queue.constants';

@Injectable()
export class RabbitMqTopologyService {
  async declare(channel: Channel): Promise<void> {
    await channel.assertExchange(MESSAGE_QUEUE_EXCHANGE, 'topic', {
      durable: true,
    });
    const bindings = [
      [MESSAGE_QUEUE_NAMES.SEARCH, [MESSAGE_ROUTING_KEYS.SEARCH_INDEX]],
      [MESSAGE_QUEUE_NAMES.RAG, [MESSAGE_ROUTING_KEYS.RAG_REBUILD]],
      [
        MESSAGE_QUEUE_NAMES.KG,
        [MESSAGE_ROUTING_KEYS.KG_REBUILD, MESSAGE_ROUTING_KEYS.KG_DELETE],
      ],
    ] as const;
    for (const [queue, keys] of bindings) {
      // Preserve existing queue arguments during upgrades with queued messages.
      await channel.assertQueue(queue, { durable: true });
      await channel.assertQueue(`${queue}.dead`, { durable: true });
      for (const key of keys) {
        await channel.bindQueue(queue, MESSAGE_QUEUE_EXCHANGE, key);
        await channel.bindQueue(
          `${queue}.dead`,
          MESSAGE_QUEUE_EXCHANGE,
          `${key}.dead`,
        );
      }
    }
  }
}
