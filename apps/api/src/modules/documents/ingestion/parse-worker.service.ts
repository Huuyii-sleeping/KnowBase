import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MessageQueueService } from '../../message-queue/message-queue.service';
import {
  MESSAGE_QUEUE_NAMES,
  MESSAGE_ROUTING_KEYS,
} from '../../message-queue/message-queue.constants';
import { ParseTaskStore } from './parse-task.store';
import { ParseJobService } from './parse-job.service';
import { ParseMaintenanceService } from './parse-maintenance.service';

@Injectable()
export class ParseWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ParseWorkerService.name);
  private timer?: NodeJS.Timeout;
  private recovering = false;
  constructor(
    private readonly queue: MessageQueueService,
    private readonly tasks: ParseTaskStore,
    private readonly job: ParseJobService,
    private readonly config: ConfigService,
    private readonly maintenance: ParseMaintenanceService,
  ) {}

  async onModuleInit() {
    const enabled = this.config.get<string | boolean>(
      'INGESTION_ASYNC_ENABLED',
      false,
    );
    const workers = this.config.get<string | boolean>(
      'PIPELINE_WORKERS_ENABLED',
      true,
    );
    if (![true, 'true'].includes(enabled) || ![true, 'true'].includes(workers))
      return;
    await this.queue.consume<{ type: string; taskId: string }>(
      MESSAGE_QUEUE_NAMES.PARSE,
      MESSAGE_ROUTING_KEYS.PARSE,
      async (message) => {
        if (message.type !== 'DOCUMENT_PARSE')
          throw new Error('Unsupported parse command');
        await this.job.run(message.taskId);
      },
    );
    await this.recover();
    this.timer = setInterval(() => {
      void this.recover();
    }, 15000);
    this.timer.unref();
  }

  private async recover() {
    if (this.recovering) return;
    this.recovering = true;
    try {
      await this.maintenance.run();
    } catch {
      this.logger.warn('Parse task recovery unavailable; retrying later.');
    } finally {
      this.recovering = false;
    }
  }
  onModuleDestroy() {
    clearInterval(this.timer);
  }
}
