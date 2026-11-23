import { Module } from '@nestjs/common';
import { IndexGenerationStore } from './index-generation.store';
import { IndexBuildService } from './index-build.service';
import { GenerationRetentionStore } from './generation-retention.store';

@Module({
  providers: [
    IndexGenerationStore,
    IndexBuildService,
    GenerationRetentionStore,
  ],
  exports: [IndexGenerationStore, IndexBuildService, GenerationRetentionStore],
})
export class IndexingModule {}
