import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KgPipelineConsumer } from './kg/kg-pipeline.consumer';
import { RagPipelineConsumer } from './rag/rag-pipeline.consumer';
import { SearchPipelineConsumer } from './search/search-pipeline.consumer';

@Injectable()
export class PipelineWorkerService implements OnModuleInit {
  private readonly logger = new Logger(PipelineWorkerService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly searchConsumer: SearchPipelineConsumer,
    private readonly ragConsumer: RagPipelineConsumer,
    private readonly kgConsumer: KgPipelineConsumer,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.isEnabled()) {
      this.logger.log('Pipeline workers are disabled');
      return;
    }

    const results = await Promise.allSettled([
      this.searchConsumer.consume(),
      this.ragConsumer.consume(),
      this.kgConsumer.consume(),
    ]);
    const failures = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );

    if (failures.length > 0) {
      this.logger.error(
        `Failed to start ${failures.length} pipeline consumer(s). RabbitMQ must be available before API startup.`,
        failures.map((failure) => String(failure.reason)).join('\n'),
      );
      return;
    }

    this.logger.log('Search, RAG and KG pipeline consumers are running');
  }

  private isEnabled(): boolean {
    const raw = this.config.get<string | boolean>('PIPELINE_WORKERS_ENABLED', true);
    return raw === true || raw === 'true';
  }
}
