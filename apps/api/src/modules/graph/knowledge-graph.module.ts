import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { PipelineModule } from '../pipeline/pipeline.module';
import { KnowledgeGraphController } from './knowledge-graph.controller';
import { KnowledgeGraphQueryService } from './knowledge-graph-query.service';

@Module({
  imports: [DocumentsModule, PipelineModule],
  controllers: [KnowledgeGraphController],
  providers: [KnowledgeGraphQueryService],
  exports: [KnowledgeGraphQueryService],
})
export class KnowledgeGraphModule {}
