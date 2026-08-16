import { Module } from '@nestjs/common';
import { RagModule } from '../rag/rag.module';
import { PipelineModule } from '../pipeline/pipeline.module';
import { RerankModule } from '../retrieval/rerank/rerank.module';
import { HybridSearchController } from './hybrid-search.controller';
import { HybridSearchService } from './hybrid-search.service';
import { SearchController } from './search.controller';
import { SearchQueryService } from './search-query.service';
import { DocumentsModule } from '../documents/documents.module';

@Module({
  imports: [PipelineModule, RagModule, RerankModule, DocumentsModule],
  controllers: [SearchController, HybridSearchController],
  providers: [SearchQueryService, HybridSearchService],
  exports: [HybridSearchService],
})
export class SearchModule {}
