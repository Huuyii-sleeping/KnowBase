import { Module } from '@nestjs/common';
import { IndexGenerationStore } from './index-generation.store';
import { IndexBuildService } from './index-build.service';
import { GenerationRetentionStore } from './generation-retention.store';
import { IndexBuildProgressStore } from './index-build-progress.store';

@Module({
  providers: [
    IndexGenerationStore,
    IndexBuildService,
    GenerationRetentionStore,
    IndexBuildProgressStore,
  ],
  exports: [
    IndexGenerationStore,
    IndexBuildService,
    GenerationRetentionStore,
    IndexBuildProgressStore,
  ],
})
export class IndexingModule {}
