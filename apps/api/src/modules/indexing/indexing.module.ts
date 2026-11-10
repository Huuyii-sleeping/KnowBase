import { Module } from '@nestjs/common';
import { IndexGenerationStore } from './index-generation.store';
import { IndexBuildService } from './index-build.service';

@Module({
  providers: [IndexGenerationStore, IndexBuildService],
  exports: [IndexGenerationStore, IndexBuildService],
})
export class IndexingModule {}
