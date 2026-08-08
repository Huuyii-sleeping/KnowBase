import { Module } from '@nestjs/common';
import { RagModule } from '../rag/rag.module';
import { PipelineModule } from '../pipeline/pipeline.module';
import { HybridSearchController } from './hybrid-search.controller';
import { HybridSearchService } from './hybrid-search.service';
import { SearchController } from './search.controller';
import { SearchQueryService } from './search-query.service';

@Module({
  imports: [PipelineModule, RagModule],
  controllers: [SearchController, HybridSearchController],
  providers: [SearchQueryService, HybridSearchService],
})
export class SearchModule {}
