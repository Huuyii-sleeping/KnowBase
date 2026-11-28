import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GenerationRetentionStore } from '../indexing/generation-retention.store';
import { integerOption } from '../ingestion/numeric-option';
import { VectorIndexService } from './vector-index/vector-index.service';
import { GraphIndexService } from './kg/graph-index.service';

@Injectable()
export class GenerationCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GenerationCleanupService.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  private readonly retentionMs: number;
  constructor(
    private readonly registry: GenerationRetentionStore,
    private readonly vector: VectorIndexService,
    private readonly graph: GraphIndexService,
    private readonly config: ConfigService,
  ) {
    this.retentionMs =
      integerOption(config, 'INDEX_GENERATION_RETENTION_HOURS', 24) * 3600000;
  }
  onModuleInit() {
    if (
      !['true', true].includes(
        this.config.get('INDEX_GENERATION_GC_ENABLED', false),
      ) ||
      !['true', true].includes(
        this.config.get('PIPELINE_WORKERS_ENABLED', true),
      )
    )
      return;
    this.timer = setInterval(() => {
      void this.run();
    }, 60000);
    this.timer.unref();
  }
  async run() {
    if (this.running) return;
    this.running = true;
    try {
      for (const candidate of await this.registry.candidates(
        this.retentionMs,
      )) {
        await this.registry.collect(candidate.generation, () =>
          candidate.pipeline === 'kg'
            ? this.graph.discardGeneration(
                candidate.document_id,
                candidate.generation,
              )
            : this.vector.discardGeneration(
                candidate.pipeline,
                candidate.generation,
              ),
        );
      }
    } catch {
      this.logger.warn(
        'Retired generation cleanup failed; retrying on the next pass.',
      );
    } finally {
      this.running = false;
    }
  }
  onModuleDestroy() {
    clearInterval(this.timer);
  }
}
