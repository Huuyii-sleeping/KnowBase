import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { connect, type ChannelModel } from 'amqplib';
import { positiveInteger } from '../delivery/reliability-options';

@Injectable()
export class RabbitMqConnectionService implements OnModuleDestroy {
  private readonly logger = new Logger(RabbitMqConnectionService.name);
  private connection?: ChannelModel;
  private pending?: Promise<ChannelModel>;
  private stopped = false;
  private readonly timeoutMs: number;

  constructor(private readonly config: ConfigService) {
    this.timeoutMs = positiveInteger(
      config,
      'RABBITMQ_CONNECT_TIMEOUT_MS',
      5000,
    );
  }

  async get(): Promise<ChannelModel> {
    if (this.stopped) throw new Error('RabbitMQ connection is shutting down');
    if (this.connection) return this.connection;
    if (!this.pending) {
      const pending = this.open();
      this.pending = pending;
      void pending
        .finally(() => {
          if (this.pending === pending) this.pending = undefined;
        })
        .catch(() => undefined);
    }
    return this.pending;
  }

  private async open(): Promise<ChannelModel> {
    const connection = await connect(
      this.config.get<string>('RABBITMQ_URL', 'amqp://localhost:15672'),
      { timeout: this.timeoutMs },
    );
    connection.on('error', (error: Error) =>
      this.logger.warn(`RabbitMQ connection error: ${error.message}`),
    );
    connection.on('close', () => {
      if (this.connection === connection) this.connection = undefined;
    });
    if (this.stopped) {
      await connection.close().catch(() => undefined);
      throw new Error('RabbitMQ connection is shutting down');
    }
    this.connection = connection;
    return connection;
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    await this.pending?.catch(() => undefined);
    await this.connection?.close().catch(() => undefined);
    this.connection = undefined;
  }
}
