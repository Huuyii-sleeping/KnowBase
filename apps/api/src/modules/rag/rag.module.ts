import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { PipelineModule } from '../pipeline/pipeline.module';
import { RagController } from './rag.controller';
import { RagQueryService } from './rag-query.service';

@Module({
  imports: [DocumentsModule, PipelineModule],
  controllers: [RagController],
  providers: [RagQueryService],
})
export class RagModule {}
