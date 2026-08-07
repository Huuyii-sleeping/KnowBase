import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StorageModule } from '../storage/storage.module';
import { Document } from './entities/document.entity';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { DocumentContent, DocumentContentSchema } from './schemas/document-content.schema';
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

@Module({
  imports: [
    TypeOrmModule.forFeature([Document]),
    MongooseModule.forFeature([
      { name: DocumentContent.name, schema: DocumentContentSchema },
    ]),
    StorageModule,
    MessageQueueModule,
  ],
  controllers: [DocumentsController],
  providers: [
    DocumentsService,
    DocumentContentStore,
    DocumentQueryService,
    DocumentCommandService,
    DocumentWorkflowService,
    DocumentPipelinePublisher,
    DocumentPublishService,
    FileParserService,
    AssetUploaderService,
    TextParser,
    MarkdownParser,
    PdfParser,
    XlsxParser,
    DocxParser,
    PptxParser,
    OfficeParserFallback,
  ],
  exports: [DocumentContentStore, DocumentQueryService],
})
export class DocumentsModule {}
