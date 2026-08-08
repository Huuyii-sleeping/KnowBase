import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { MessageQueueModule } from '../message-queue/message-queue.module';
import { MarkdownChunkerService } from './chunk/markdown-chunker.service';
import { EmbeddingService } from './embedding/embedding.service';
import { GraphIndexService } from './kg/graph-index.service';
import { KgPipelineConsumer } from './kg/kg-pipeline.consumer';
import { KgPipelineService } from './kg/kg-pipeline.service';
import { PipelineWorkerService } from './pipeline-worker.service';
import { RagPipelineConsumer } from './rag/rag-pipeline.consumer';
import { RagPipelineService } from './rag/rag-pipeline.service';
import { SearchPipelineConsumer } from './search/search-pipeline.consumer';
import { SearchPipelineService } from './search/search-pipeline.service';
import { VectorIndexService } from './vector-index/vector-index.service';

@Module({
  imports: [DocumentsModule, MessageQueueModule],
  providers: [
    MarkdownChunkerService,
    EmbeddingService,
    VectorIndexService,
    GraphIndexService,
    SearchPipelineService,
    RagPipelineService,
    KgPipelineService,
    SearchPipelineConsumer,
    RagPipelineConsumer,
    KgPipelineConsumer,
    PipelineWorkerService,
  ],
  exports: [VectorIndexService],
})
export class PipelineModule {}
