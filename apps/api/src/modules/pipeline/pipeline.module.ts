import { UpgradeScanStore } from './upgrades/upgrade-scan.store';
import { UpgradeDispatchStore } from './upgrades/upgrade-dispatch.store';
import { UpgradePlanStore } from './upgrades/upgrade-plan.store';
import { UpgradePolicyService } from './upgrades/upgrade-policy.service';
import { UpgradePreviewService } from './upgrades/upgrade-preview.service';
import { UpgradeCommandService } from './upgrades/upgrade-command.service';
import { UpgradeSchedulerService } from './upgrades/upgrade-scheduler.service';
import { UpgradeExecutionStore } from './upgrades/upgrade-execution.store';
import { UpgradeRunnerService } from './upgrades/upgrade-runner.service';
import { UpgradeManagementService } from './upgrades/upgrade-management.service';
import { UpgradeController } from './upgrades/upgrade.controller';
import { DeliveryModule } from '../delivery/delivery.module';
import { IngestionArtifactsModule } from '../ingestion/artifacts/ingestion-artifacts.module';
import { DocumentChunksService } from './chunk/document-chunks.service';
import { DocumentEmbeddingService } from './embedding/document-embedding.service';
import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { MessageQueueModule } from '../message-queue/message-queue.module';
import { MarkdownChunkerService } from './chunk/markdown-chunker.service';
import { EmbeddingService } from './embedding/embedding.service';
import { GraphIndexService } from './kg/graph-index.service';
import { GraphExtractionService } from './kg/graph-extraction.service';
import { KgPipelineConsumer } from './kg/kg-pipeline.consumer';
import { KgPipelineService } from './kg/kg-pipeline.service';
import { OllamaGraphExtractorService } from './kg/ollama-graph-extractor.service';
import { PipelineWorkerService } from './pipeline-worker.service';
import { RagPipelineConsumer } from './rag/rag-pipeline.consumer';
import { RagPipelineService } from './rag/rag-pipeline.service';
import { SearchPipelineConsumer } from './search/search-pipeline.consumer';
import { SearchPipelineService } from './search/search-pipeline.service';
import { VectorIndexService } from './vector-index/vector-index.service';
import { IndexingModule } from '../indexing/indexing.module';
import { GenerationCleanupService } from './generation-cleanup.service';

@Module({
  imports: [
    DeliveryModule,
    DocumentsModule,
    MessageQueueModule,
    IndexingModule,
    IngestionArtifactsModule,
  ],
  controllers: [UpgradeController],
  providers: [
    UpgradePlanStore,
    UpgradeScanStore,
    UpgradePolicyService,
    UpgradePreviewService,
    UpgradeCommandService,
    UpgradeSchedulerService,
    UpgradeDispatchStore,
    UpgradeExecutionStore,
    UpgradeRunnerService,
    UpgradeManagementService,
    MarkdownChunkerService,
    DocumentChunksService,
    DocumentEmbeddingService,
    EmbeddingService,
    VectorIndexService,
    GraphIndexService,
    GraphExtractionService,
    OllamaGraphExtractorService,
    {
      provide: 'GRAPH_EXTRACTION_PROVIDER',
      useExisting: OllamaGraphExtractorService,
    },
    SearchPipelineService,
    RagPipelineService,
    KgPipelineService,
    SearchPipelineConsumer,
    RagPipelineConsumer,
    KgPipelineConsumer,
    PipelineWorkerService,
    GenerationCleanupService,
  ],
  exports: [EmbeddingService, VectorIndexService, GraphIndexService],
})
export class PipelineModule {}
