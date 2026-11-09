import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { MESSAGE_QUEUE_NAMES } from './message-queue.constants';
import type { MessageHandler } from './message-queue.types';
import {
  RabbitMqPublisherService,
  type PublishOptions,
} from './rabbitmq-publisher.service';
import { RabbitMqConsumerService } from './rabbitmq-consumer.service';

@Injectable()
export class MessageQueueService {
  constructor(
    private readonly publisher: RabbitMqPublisherService,
    private readonly consumers: RabbitMqConsumerService,
  ) {}

  publish<T>(routingKey: string, message: T): Promise<void> {
    return this.publishRaw(routingKey, JSON.stringify(message), {
      messageId: randomUUID(),
      attempt: 0,
    });
  }

  publishRaw(
    routingKey: string,
    body: string,
    options: PublishOptions,
  ): Promise<void> {
    return this.publisher.publish(routingKey, Buffer.from(body), options);
  }

  consume<T>(
    queue: (typeof MESSAGE_QUEUE_NAMES)[keyof typeof MESSAGE_QUEUE_NAMES],
    _routingKeys: string | string[],
    handler: MessageHandler<T>,
  ): Promise<void> {
    return this.consumers.subscribe(queue, handler);
  }
}
