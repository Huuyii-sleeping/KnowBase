import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Document } from '../documents/entities/document.entity';
import { IndexGenerationStore, IndexPipeline } from './index-generation.store';

@Injectable()
export class IndexBuildService {
  private readonly logger = new Logger(IndexBuildService.name);
  constructor(private readonly generations: IndexGenerationStore) {}

  async build(
    document: Document,
    pipeline: IndexPipeline,
    stage: (generation: string) => Promise<void>,
    discard: (generation: string) => Promise<void>,
  ): Promise<boolean> {
    const generation = randomUUID();
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
      await stage(generation);
    } catch (error) {
      await cleanup();
      throw error;
    }
    // A failed DB COMMIT may have succeeded remotely. Preserve staged data on
    // uncertain activation; deleting it could remove the active generation.
    const activated = await this.generations.activate(
      document,
      pipeline,
      generation,
    );
    if (!activated) await cleanup();
    return activated;
  }
}
