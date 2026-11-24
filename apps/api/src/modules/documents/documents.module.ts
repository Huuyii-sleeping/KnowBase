import { SupplementaryParsers } from './parsing/supplementary-parsers';
import { ParsedDocumentEnricher } from './parsing/parsed-document.enricher';
import { DocumentArtifactVerifier } from './evidence/document-artifact-verifier';
import { ImageSemanticEnricher } from './parsing/vision/image-semantic-enricher';
import { VisionDescriptionAdapter } from './parsing/vision/vision-description.adapter';
import { XlsEvidenceExtractor } from './parsing/xlsx/xls-evidence.extractor';
import { WebImportService } from './web-import.service';
import { WebSnapshotFetcher } from './parsing/web/web-snapshot.fetcher';
import { WebSnapshotParser } from './parsing/web/web-snapshot.parser';
import { OrphanAssetCleanupService } from './ingestion/orphan-asset-cleanup.service';
import { DocumentEvidenceController } from './evidence/document-evidence.controller';
import { DocumentEvidenceQueryService } from './evidence/document-evidence-query.service';
import { ParseDraftService } from './ingestion/parse-draft.service';
import { EVIDENCE_MODEL, EvidenceSchema } from './evidence/evidence.schema';
import { DocumentEvidenceStore } from './evidence/document-evidence.store';
import { XlsxEvidenceExtractor } from './parsing/xlsx/xlsx-evidence.extractor';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StorageModule } from '../storage/storage.module';
import { Document } from './entities/document.entity';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import {
  DocumentContent,
  DocumentContentSchema,
} from './schemas/document-content.schema';
import { FileParserService } from './parsing/file-parser.service';
import { AssetUploaderService } from './parsing/asset-uploader.service';
import { TextParser } from './parsing/parsers/text.parser';
import { MarkdownParser } from './parsing/parsers/markdown.parser';
import { PdfParser } from './parsing/parsers/pdf.parser';
import { XlsxParser } from './parsing/parsers/xlsx.parser';
import { DocxParser } from './parsing/parsers/docx.parser';
import { PptxParser } from './parsing/parsers/pptx.parser';
import { OfficeParserFallback } from './parsing/parsers/office-parser.fallback';
import { DocumentContentStore } from './document-content.store';
import { DocumentQueryService } from './document-query.service';
import { DocumentCommandService } from './document-command.service';
import { DocumentWorkflowService } from './document-workflow.service';
import { DocumentPipelinePublisher } from './document-pipeline.publisher';
import { DocumentPublishService } from './document-publish.service';
import { MessageQueueModule } from '../message-queue/message-queue.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { DeliveryModule } from '../delivery/delivery.module';
import { IndexingModule } from '../indexing/indexing.module';
import { DocumentRevisionService } from './document-revision.service';
import { DocumentDeletionService } from './document-deletion.service';
import { DocumentSourceCleanupService } from './document-source-cleanup.service';
import { DocumentAssetsCleanupService } from './document-assets-cleanup.service';
import { IngestionArtifactsModule } from '../ingestion/artifacts/ingestion-artifacts.module';
import { MineruParser } from './parsing/mineru/mineru.parser';
import { ParseTaskStore } from './ingestion/parse-task.store';
import { ParseResultService } from './ingestion/parse-result.service';
import { ParseJobService } from './ingestion/parse-job.service';
import { ParseSubmissionService } from './ingestion/parse-submission.service';
import { ParseWorkerService } from './ingestion/parse-worker.service';
import { ParseTaskCleanupStore } from './ingestion/parse-task-cleanup.store';
import { ParseMaintenanceService } from './ingestion/parse-maintenance.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Document]),
    MongooseModule.forFeature([
      { name: DocumentContent.name, schema: DocumentContentSchema },
      { name: EVIDENCE_MODEL, schema: EvidenceSchema },
    ]),
    StorageModule,
    MessageQueueModule,
    DeliveryModule,
    IndexingModule,
    AuthorizationModule,
    IngestionArtifactsModule,
  ],
  controllers: [
    DocumentsController,
    DocumentEvidenceController,
  ],
  providers: [
    DocumentsService,
    DocumentContentStore,
    DocumentEvidenceStore,
    DocumentArtifactVerifier,
    DocumentEvidenceQueryService,
    ParseDraftService,
    DocumentQueryService,
    DocumentCommandService,
    DocumentRevisionService,
    DocumentDeletionService,
    DocumentSourceCleanupService,
    DocumentAssetsCleanupService,
    DocumentWorkflowService,
    DocumentPipelinePublisher,
    DocumentPublishService,
    FileParserService,
    SupplementaryParsers,
    ParsedDocumentEnricher,
    MineruParser,
    ParseTaskStore,
    ParseResultService,
    ParseJobService,
    ParseSubmissionService,
    ParseWorkerService,
    ParseMaintenanceService,
    OrphanAssetCleanupService,
    ParseTaskCleanupStore,
    AssetUploaderService,
    TextParser,
    MarkdownParser,
    PdfParser,
    XlsxParser,
    XlsxEvidenceExtractor,
    XlsEvidenceExtractor,
    WebImportService,
    WebSnapshotFetcher,
    WebSnapshotParser,
    ImageSemanticEnricher,
    VisionDescriptionAdapter,
    DocxParser,
    PptxParser,
    OfficeParserFallback,
  ],
  exports: [
    DocumentContentStore,
    DocumentEvidenceStore,
    DocumentQueryService,
    DocumentSourceCleanupService,
    DocumentAssetsCleanupService,
    ParseSubmissionService,
  ],
})
export class DocumentsModule {}
