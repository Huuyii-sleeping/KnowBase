import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  connect,
  type Channel,
  type ChannelModel,
  type ConsumeMessage,
} from 'amqplib';
import {
  MESSAGE_QUEUE_EXCHANGE,
  MESSAGE_QUEUE_NAMES,
} from './message-queue.constants';
import type { MessageHandler } from './message-queue.types';

@Injectable()
export class MessageQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(MessageQueueService.name);
  private connection?: ChannelModel;
  private channel?: Channel;
  private channelPromise?: Promise<Channel>;

  constructor(private readonly config: ConfigService) {}

  async publish<T>(routingKey: string, message: T): Promise<void> {
    const channel = await this.getChannel();
    await this.assertExchange(channel);

    const published = channel.publish(
      MESSAGE_QUEUE_EXCHANGE,
      routingKey,
      Buffer.from(JSON.stringify(message)),
      {
        contentType: 'application/json',
        persistent: true,
      },
    );

    if (!published) {
      await new Promise<void>((resolve) => channel.once('drain', resolve));
    }
  }

  async consume<T>(
    queueName: (typeof MESSAGE_QUEUE_NAMES)[keyof typeof MESSAGE_QUEUE_NAMES],
    routingKey: string,
    handler: MessageHandler<T>,
  ): Promise<void> {
    const channel = await this.getChannel();
    await this.assertExchange(channel);
    await channel.assertQueue(queueName, { durable: true });
    await channel.bindQueue(queueName, MESSAGE_QUEUE_EXCHANGE, routingKey);
    await channel.prefetch(
      Number(this.config.get<string | number>('RABBITMQ_PREFETCH', 1)),
    );

    await channel.consume(queueName, (message) => {
      if (!message) {
        return;
      }
      void this.handleMessage(channel, message, handler);
    });

    this.logger.log(`RabbitMQ consumer ready: ${queueName} <- ${routingKey}`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.channel?.close().catch(() => undefined);
    await this.connection?.close().catch(() => undefined);
  }

  private async getChannel(): Promise<Channel> {
    if (this.channel) {
      return this.channel;
    }

    this.channelPromise ??= this.createChannel();
    try {
      this.channel = await this.channelPromise;
      return this.channel;
    } catch (error) {
      this.channelPromise = undefined;
      throw error;
    }
  }

  private async createChannel(): Promise<Channel> {
    this.connection = await connect(
      this.config.get<string>('RABBITMQ_URL', 'amqp://localhost:5672'),
    );
    return this.connection.createChannel();
  }

  private async assertExchange(channel: Channel): Promise<void> {
    await channel.assertExchange(MESSAGE_QUEUE_EXCHANGE, 'topic', {
      durable: true,
    });
  }

  private async handleMessage<T>(
    channel: Channel,
    message: ConsumeMessage,
    handler: MessageHandler<T>,
  ): Promise<void> {
    try {
      const payload = JSON.parse(message.content.toString()) as T;
      await handler(payload);
      channel.ack(message);
    } catch (error) {
      this.logger.error(
        `RabbitMQ message failed: ${message.fields.routingKey}`,
        error instanceof Error ? error.stack : String(error),
      );
      channel.nack(
        message,
        false,
        this.getBoolean('RABBITMQ_REQUEUE_ON_ERROR', false),
      );
    }
  }

  private getBoolean(key: string, fallback: boolean): boolean {
    const value = this.config.get<string | boolean>(key, fallback);
    if (typeof value === 'boolean') {
      return value;
    }
    return value.toLowerCase() === 'true';
  }
}
