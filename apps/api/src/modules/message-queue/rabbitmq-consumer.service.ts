import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import type { Channel, ConsumeMessage } from 'amqplib';
import { MessageProcessingService } from '../delivery/message-processing.service';
import { positiveInteger } from '../delivery/reliability-options';
import { RabbitMqConnectionService } from './rabbitmq-connection.service';
import { RabbitMqTopologyService } from './rabbitmq-topology.service';
import type { MessageHandler } from './message-queue.types';

interface Subscription {
  channel?: Channel;
  connecting?: Promise<void>;
  handler: MessageHandler<any>;
}

@Injectable()
export class RabbitMqConsumerService implements OnModuleDestroy {
  private readonly logger = new Logger(RabbitMqConsumerService.name);
  private readonly subscriptions = new Map<string, Subscription>();
  private readonly inFlight = new Set<Promise<void>>();
  private timer?: NodeJS.Timeout;
  private stopped = false;
  private readonly prefetch: number;
  private readonly reconnectMs: number;

  constructor(
    config: ConfigService,
    private readonly connection: RabbitMqConnectionService,
    private readonly topology: RabbitMqTopologyService,
    private readonly processing: MessageProcessingService,
  ) {
    this.prefetch = positiveInteger(config, 'RABBITMQ_PREFETCH', 1);
    this.reconnectMs = positiveInteger(
      config,
      'RABBITMQ_RECONNECT_INTERVAL_MS',
      5000,
    );
  }

  async subscribe<T>(queue: string, handler: MessageHandler<T>): Promise<void> {
    if (!this.subscriptions.has(queue))
      this.subscriptions.set(queue, { handler });
    if (!this.timer) {
      this.timer = setInterval(() => {
        void this.reconnect();
      }, this.reconnectMs);
      this.timer.unref();
    }
    await this.attach(queue, this.subscriptions.get(queue)!);
  }

  private async reconnect(): Promise<void> {
    await Promise.all(
      [...this.subscriptions].map(([queue, subscription]) =>
        this.attach(queue, subscription),
      ),
    );
  }

  private async attach(
    queue: string,
    subscription: Subscription,
  ): Promise<void> {
    if (this.stopped || subscription.channel) return;
    if (subscription.connecting) return subscription.connecting;
    const connecting = this.open(queue, subscription).catch(
      (error: unknown) => {
        this.logger.warn(
          `RabbitMQ consumer ${queue} unavailable; reconnect scheduled: ${error instanceof Error ? error.message : String(error)}`,
        );
      },
    );
    subscription.connecting = connecting;
    try {
      await connecting;
    } finally {
      subscription.connecting = undefined;
    }
  }

  private async open(queue: string, subscription: Subscription): Promise<void> {
    const connection = await this.connection.get();
    const channel = await connection.createChannel();
    channel.on('error', (error: Error) =>
      this.logger.warn(`RabbitMQ consumer ${queue}: ${error.message}`),
    );
    channel.on('close', () => {
      if (subscription.channel === channel) subscription.channel = undefined;
    });
    try {
      await this.topology.declare(channel);
      await channel.prefetch(this.prefetch);
      if (this.stopped) {
        await channel.close();
        return;
      }
      subscription.channel = channel;
      await channel.consume(queue, (message) => {
        if (!message) {
          void channel.close().catch(() => undefined);
          return;
        }
        const work = this.handle(queue, channel, message, subscription.handler);
        this.inFlight.add(work);
        void work.finally(() => this.inFlight.delete(work));
      });
      this.logger.log(`RabbitMQ consumer ready: ${queue}`);
    } catch (error) {
      await channel.close().catch(() => undefined);
      throw error;
    }
  }

  private async handle(
    queue: string,
    channel: Channel,
    message: ConsumeMessage,
    handler: MessageHandler<any>,
  ): Promise<void> {
    try {
      const attempt = message.properties.headers?.['x-knowbase-attempt'] ?? 0;
      const validAttempt = Number.isSafeInteger(attempt) && attempt >= 0;
      const messageId = message.properties.messageId;
      await this.processing.process(
        queue,
        {
          // Older queued messages have no messageId; keep their redelivery stable.
          eventId:
            messageId && messageId.length <= 128
              ? messageId
              : createHash('sha256')
                  .update(message.fields.routingKey)
                  .update(message.content)
                  .digest('hex'),
          routingKey: message.fields.routingKey,
          body: message.content.toString('utf8'),
          attempt: validAttempt ? attempt : 0,
        },
        async (payload) => {
          if (!validAttempt) throw new Error('invalid message attempt header');
          await handler(payload);
        },
      );
      channel.ack(message);
    } catch (error) {
      this.logger.error(
        `RabbitMQ settlement failed for ${queue}`,
        error instanceof Error ? error.stack : String(error),
      );
      // Do not ack on persistence failure. Closing requeues the delivery and
      // reconnect backoff prevents an immediate redelivery hot loop.
      await channel.close().catch(() => undefined);
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    clearInterval(this.timer);
    await Promise.all(
      [...this.subscriptions.values()].map(async (subscription) => {
        await subscription.connecting;
        await subscription.channel?.close().catch(() => undefined);
      }),
    );
    await Promise.allSettled([...this.inFlight]);
  }
}
