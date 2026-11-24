import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StorageService } from '../storage/storage.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { UpdateContentDto } from './dto/update-content.dto';
import { UpdateDocumentDto } from './dto/update-document.dto';
import {
  Document,
  DocumentParseStatus,
  DocumentStatus,
} from './entities/document.entity';
import { FileParserService } from './parsing/file-parser.service';
import { DocumentContentStore } from './document-content.store';
import { AuthUser } from '../auth/auth.types';
import { DocumentVisibility } from '../authorization/document-access.service';
import { DocumentRevisionService } from './document-revision.service';
import { DocumentDeletionService } from './document-deletion.service';
import { parseDocumentTags } from './document-tags.util';
import { ParsedDocument } from './parsing/file-parser.types';
import { ParseSubmissionService } from './ingestion/parse-submission.service';

@Injectable()
export class DocumentCommandService {
  private readonly logger = new Logger(DocumentCommandService.name);
  constructor(
    @InjectRepository(Document)
    private readonly documentRepository: Repository<Document>,
    private readonly contentStore: DocumentContentStore,
    private readonly storage: StorageService,
    private readonly fileParser: FileParserService,
    private readonly revisions: DocumentRevisionService,
    private readonly deletion: DocumentDeletionService,
    private readonly parseTasks: ParseSubmissionService,
  ) {}

  async create(
    file: Express.Multer.File | undefined,
    dto: CreateDocumentDto,
    user: AuthUser,
  ): Promise<string> {
    if (!file) {
      throw new BadRequestException({
        code: 'FILE_REQUIRED',
        message: 'file is required',
      });
    }

    const documentId = randomUUID();
    const contentId = randomUUID();
    const originalName = file.originalname || 'uploaded-file';
    if (!this.fileParser.supports(originalName)) {
      throw new BadRequestException({
        code: 'FILE_UNSUPPORTED',
        message: 'File format is not supported by the configured parser',
      });
    }

    if (file.size === 0) {
      throw new BadRequestException({
        code: 'FILE_EMPTY',
        message: 'file is empty',
      });
    }

    this.fileParser.assertFileBudget(file.buffer);

    const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storageKey = `original/${documentId}/${safeName}`;
    const title =
      dto.title?.trim() || originalName.replace(extname(originalName), '');

    const document = this.documentRepository.create({
      id: documentId,
      title,
      fileName: originalName,
      mimeType: file.mimetype || 'application/octet-stream',
      fileSize: file.size,
      storageKey,
      contentId,
      uploaderId: user.id,
      category: dto.category ?? null,
      team: dto.team ?? null,
      tags: parseDocumentTags(dto.tags),
      status: DocumentStatus.DRAFT,
      parseStatus: DocumentParseStatus.PENDING,
      parseError: null,
      rejectionReason: null,
      version: 1,
      permissions: {
        visibility: dto.visibility ?? DocumentVisibility.PRIVATE,
        userIds: [],
        teams: [],
      },
      statistics: { viewCount: 0, queryCount: 0 },
      submittedAt: null,
      reviewedAt: null,
      reviewedBy: null,
    });

    await this.storage.putObject(
      storageKey,
      file.buffer,
      file.mimetype || 'application/octet-stream',
    );

    let parsedAssets: ParsedDocument['assets'] = [];
    let persistedDocument = false;
    try {
      if (this.parseTasks.enabled && !dto.markdown?.trim()) {
        await this.parseTasks.create(document);
        persistedDocument = true;
        return document.id;
      }
      const parsed: ParsedDocument = dto.markdown?.trim()
        ? {
            markdown: dto.markdown.trim() + '\n',
            assets: [],
            ready: true,
            parser: 'provided-markdown',
            warnings: [],
          }
        : await this.fileParser.parse(file.buffer, originalName, documentId);
      parsedAssets = parsed.assets;

      await this.contentStore.create({
        contentId,
        documentId,
        markdown: parsed.markdown,
        parser: parsed.parser,
        warnings: parsed.warnings,
        version: 1,
        assets: parsed.assets,
        sections: parsed.sections,
        parseStrategy: parsed.parseStrategy,
        quality: parsed.quality,
        provenance: parsed.provenance,
        evidence: parsed.evidence,
        ready: parsed.ready,
      });

      document.parseStatus = parsed.ready
        ? DocumentParseStatus.READY
        : parsed.error
          ? DocumentParseStatus.FAILED
          : DocumentParseStatus.PENDING;
      document.parseError = parsed.error ?? null;

      await this.documentRepository.save(document);
      persistedDocument = true;
      return document.id;
    } catch (error) {
      if (this.parseTasks.enabled && !dto.markdown?.trim()) {
        // A lost COMMIT reply must not remove the original used by a live task.
        try {
          if (
            await this.documentRepository.findOne({ where: { id: documentId } })
          )
            throw error;
        } catch (lookupError) {
          throw lookupError;
        }
      }
      if (parsedAssets.length) {
        try {
          await this.fileParser.discardAssets(documentId, parsedAssets);
        } catch {
          this.logger.error(
            `Unable to schedule extracted asset cleanup for ${documentId}`,
          );
        }
      }
      await this.storage.removeObject(storageKey).catch(() => undefined);
      await this.contentStore
        .deleteByContentId(contentId)
        .catch(() => undefined);
      if (persistedDocument)
        await this.documentRepository.delete(documentId).catch(() => undefined);
      throw error;
    }
  }

  updateMetadata(
    id: string,
    dto: UpdateDocumentDto,
    user?: AuthUser,
  ): Promise<void> {
    return this.revisions.updateMetadata(id, dto, user);
  }

  updateContent(
    id: string,
    dto: UpdateContentDto,
    user?: AuthUser,
  ): Promise<void> {
    return this.revisions.updateContent(id, dto, user);
  }

  remove(id: string, user?: AuthUser): Promise<void> {
    return this.deletion.remove(id, user);
  }
}
