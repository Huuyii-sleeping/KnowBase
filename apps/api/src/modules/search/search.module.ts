import { Module } from '@nestjs/common';
import { PipelineModule } from '../pipeline/pipeline.module';
import { SearchController } from './search.controller';
import { SearchQueryService } from './search-query.service';

@Module({
  imports: [PipelineModule],
  controllers: [SearchController],
  providers: [SearchQueryService],
})
export class SearchModule {}
