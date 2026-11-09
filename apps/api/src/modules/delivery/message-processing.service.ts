import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeliveryReceiptStore } from './delivery-receipt.store';
import { IncomingDelivery } from './delivery.types';
import { OutboxStore } from './outbox.store';
import { positiveInteger, retryDelay } from './reliability-options';

@Injectable()
export class MessageProcessingService {
  private readonly logger = new Logger(MessageProcessingService.name);
  private readonly maxAttempts: number;
  private readonly retryMs: number;

  constructor(
    config: ConfigService,
    private readonly receipts: DeliveryReceiptStore,
    private readonly outbox: OutboxStore,
  ) {
    this.maxAttempts = positiveInteger(config, 'PIPELINE_MAX_ATTEMPTS', 3);
    this.retryMs = positiveInteger(config, 'PIPELINE_RETRY_DELAY_MS', 5000);
  }

  async process(
    consumer: string,
    delivery: IncomingDelivery,
    handler: (payload: any) => Promise<void>,
  ): Promise<void> {
    await this.receipts.withLock(
      consumer,
      delivery.eventId,
      async (manager, receipt) => {
        if (
          receipt.status === 'COMPLETED' ||
          receipt.status === 'DEAD' ||
          receipt.attempt >= delivery.attempt
        )
          return;

        let failure: string | undefined;
        try {
          const payload: unknown = JSON.parse(delivery.body);
          if (
            !payload ||
            typeof payload !== 'object' ||
            Array.isArray(payload)
          ) {
            throw new Error('pipeline message must be a JSON object');
          }
          await handler(payload);
        } catch (error) {
          failure = error instanceof Error ? error.message : String(error);
        }
        if (failure === undefined) {
          await this.receipts.record(
            manager,
            consumer,
            delivery.eventId,
            'COMPLETED',
            delivery.attempt,
          );
          return;
        }

        const error = failure;
        const nextAttempt = delivery.attempt + 1;
        const dead = nextAttempt >= this.maxAttempts;
        await this.outbox.schedule(
          manager,
          {
            ...delivery,
            attempt: nextAttempt,
            routingKey: dead
              ? `${delivery.routingKey}.dead`
              : delivery.routingKey,
          },
          dead ? 0 : retryDelay(nextAttempt, this.retryMs),
          error,
        );
        await this.receipts.record(
          manager,
          consumer,
          delivery.eventId,
          dead ? 'DEAD' : 'RETRY',
          delivery.attempt,
          error,
        );
        this.logger.warn(
          `${consumer}: event ${delivery.eventId} ${dead ? 'dead-lettered' : 'scheduled for retry'} after attempt ${nextAttempt}`,
        );
      },
    );
  }
}
