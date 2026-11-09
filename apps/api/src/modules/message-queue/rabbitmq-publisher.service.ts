import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { ConfirmChannel, Message } from 'amqplib';
import { positiveInteger } from '../delivery/reliability-options';
import { RabbitMqConnectionService } from './rabbitmq-connection.service';
import { RabbitMqTopologyService } from './rabbitmq-topology.service';
import { MESSAGE_QUEUE_EXCHANGE } from './message-queue.constants';

export interface PublishOptions {
  messageId: string;
  attempt: number;
}

@Injectable()
export class RabbitMqPublisherService implements OnModuleDestroy {
  private readonly logger = new Logger(RabbitMqPublisherService.name);
  private channel?: ConfirmChannel;
  private opening?: Promise<ConfirmChannel>;
  private readonly pending = new Map<
    string,
    { channel: ConfirmChannel; finish: (error?: Error) => void }
  >();
  private readonly timeoutMs: number;
  private stopped = false;

  constructor(
    config: ConfigService,
    private readonly connection: RabbitMqConnectionService,
    private readonly topology: RabbitMqTopologyService,
  ) {
    this.timeoutMs = positiveInteger(
      config,
      'RABBITMQ_CONFIRM_TIMEOUT_MS',
      10000,
    );
  }

  async publish(
    routingKey: string,
    body: Buffer,
    options: PublishOptions,
  ): Promise<void> {
    const channel = await this.getChannel();
    const correlationId = randomUUID();
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        if (!this.pending.delete(correlationId)) return;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      };
      const timer = setTimeout(() => {
        finish(new Error('RabbitMQ publisher confirm timed out'));
        if (this.channel === channel) this.channel = undefined;
        void channel.close().catch(() => undefined);
      }, this.timeoutMs);
      this.pending.set(correlationId, { channel, finish });
      try {
        // The callback is the broker confirm; the boolean is only backpressure.
        channel.publish(
          MESSAGE_QUEUE_EXCHANGE,
          routingKey,
          body,
          {
            mandatory: true,
            persistent: true,
            contentType: 'application/json',
            messageId: options.messageId,
            correlationId,
            headers: { 'x-knowbase-attempt': options.attempt },
          },
          (error) => finish(error ?? undefined),
        );
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private async getChannel(): Promise<ConfirmChannel> {
    if (this.stopped) throw new Error('RabbitMQ publisher is shutting down');
    if (this.channel) return this.channel;
    if (!this.opening) {
      const opening = this.open();
      this.opening = opening;
      void opening
        .finally(() => {
          if (this.opening === opening) this.opening = undefined;
        })
        .catch(() => undefined);
    }
    return this.opening;
  }

  private async open(): Promise<ConfirmChannel> {
    const connection = await this.connection.get();
    const channel = await connection.createConfirmChannel();
    channel.on('error', (error: Error) =>
      this.logger.warn(`RabbitMQ publisher error: ${error.message}`),
    );
    channel.on('return', (message: Message) => {
      this.pending
        .get(message.properties.correlationId)
        ?.finish(
          new Error(
            `RabbitMQ message was unroutable: ${message.fields.routingKey}`,
          ),
        );
    });
    channel.on('close', () => {
      if (this.channel === channel) this.channel = undefined;
      for (const pending of this.pending.values()) {
        if (pending.channel === channel)
          pending.finish(new Error('RabbitMQ publisher channel closed'));
      }
    });
    try {
      await this.topology.declare(channel);
      if (this.stopped) throw new Error('RabbitMQ publisher is shutting down');
      this.channel = channel;
      return channel;
    } catch (error) {
      await channel.close().catch(() => undefined);
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    await this.opening?.catch(() => undefined);
    await this.channel?.close().catch(() => undefined);
  }
}
