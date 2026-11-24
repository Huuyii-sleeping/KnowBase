import { Injectable, Logger, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Document } from '../documents/entities/document.entity';
import { IndexGenerationStore, IndexPipeline } from './index-generation.store';
import { ingestionStage } from '../ingestion/ingestion-stage';
import {
  IndexBuildProgressStore,
  BuildReporter,
} from './index-build-progress.store';

@Injectable()
export class IndexBuildService {
  private readonly logger = new Logger(IndexBuildService.name);
  constructor(
    private readonly generations: IndexGenerationStore,
    @Optional() private readonly progress?: IndexBuildProgressStore,
  ) {}

  private async observe(operation: () => Promise<void>) {
    try {
      await operation();
    } catch {
      this.logger.warn(
        'Index build progress could not be saved; index visibility is still controlled by the generation head.',
      );
    }
  }

  async build(
    document: Document,
    pipeline: IndexPipeline,
    stage: (generation: string, report: BuildReporter) => Promise<void>,
    discard: (generation: string) => Promise<void>,
  ): Promise<boolean> {
    const generation = randomUUID();
    if (this.progress)
      await this.observe(() =>
        this.progress!.start(document, pipeline, generation),
      );
    const report: BuildReporter = async (stage, completed = 0, total = 0) => {
      if (this.progress)
        await this.observe(() =>
          this.progress!.report(generation, stage, completed, total),
        );
    };
    const finish = async (
      state: 'succeeded' | 'failed' | 'superseded' | 'activation_unknown',
    ) => {
      if (this.progress) {
        await this.observe(() => this.progress!.finish(generation, state));
        await this.observe(() => this.progress!.prune());
      }
    };
    const cleanup = async () => {
      try {
        await discard(generation);
      } catch (error) {
        this.logger.warn(
          `Orphan generation ${generation} requires cleanup: ${String(error)}`,
        );
      }
    };
    try {
      await stage(generation, report);
    } catch (error) {
      await cleanup();
      await finish('failed');
      throw error;
    }
    // A failed DB COMMIT may have succeeded remotely. Preserve staged data on
    // uncertain activation; deleting it could remove the active generation.
    await report('activating');
    let activated: boolean;
    try {
      activated = await ingestionStage(
        'index.activate',
        {
          documentId: document.id,
          version: document.version,
          pipeline,
          generation,
        },
        () => this.generations.activate(document, pipeline, generation),
      );
    } catch (error) {
      await finish('activation_unknown');
      throw error;
    }
    if (!activated) await cleanup();
    await finish(activated ? 'succeeded' : 'superseded');
    return activated;
  }
}
