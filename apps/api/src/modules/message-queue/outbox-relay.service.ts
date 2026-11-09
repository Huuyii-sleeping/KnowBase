import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OutboxStore } from '../delivery/outbox.store';
import { positiveInteger, retryDelay } from '../delivery/reliability-options';
import { MessageQueueService } from './message-queue.service';

@Injectable()
export class OutboxRelayService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelayService.name);
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;
  private stopped = false;
  private readonly pollMs: number;
  private readonly batchSize: number;

  constructor(
    private readonly config: ConfigService,
    private readonly outbox: OutboxStore,
    private readonly messages: MessageQueueService,
  ) {
    this.pollMs = positiveInteger(config, 'OUTBOX_POLL_INTERVAL_MS', 1000);
    this.batchSize = positiveInteger(config, 'OUTBOX_BATCH_SIZE', 20);
  }

  onModuleInit(): void {
    const enabled = this.config.get<string | boolean>(
      'OUTBOX_RELAY_ENABLED',
      true,
    );
    if (enabled !== true && enabled !== 'true') return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.pollMs);
    this.timer.unref();
    void this.tick();
  }

  async tick(): Promise<void> {
    if (this.stopped) return;
    if (this.running) return this.running;
    this.running = this.drain().catch((error: unknown) => {
      this.logger.error(
        'Outbox relay failed; pending tasks will be retried',
        error instanceof Error ? error.stack : String(error),
      );
    });
    try {
      await this.running;
    } finally {
      this.running = undefined;
    }
  }

  private async drain(): Promise<void> {
    for (let index = 0; index < this.batchSize && !this.stopped; index += 1) {
      const outcome = await this.outbox.dispatchOne(
        async (message) => {
          await this.messages.publishRaw(message.routing_key, message.body, {
            messageId: message.event_id,
            attempt: message.attempt,
          });
        },
        (attempt) => retryDelay(attempt, this.pollMs),
      );
      if (outcome === 'empty') break;
      if (outcome === 'retry') {
        this.logger.warn('Outbox delivery failed; retained for retry');
        break;
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    clearInterval(this.timer);
    await this.running;
  }
}
