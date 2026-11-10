import { BadRequestException, Injectable } from '@nestjs/common';
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

@Injectable()
export class DocumentCommandService {
  constructor(
    @InjectRepository(Document)
    private readonly documentRepository: Repository<Document>,
    private readonly contentStore: DocumentContentStore,
    private readonly storage: StorageService,
    private readonly fileParser: FileParserService,
    private readonly revisions: DocumentRevisionService,
    private readonly deletion: DocumentDeletionService,
  ) {}

  async create(
    file: Express.Multer.File | undefined,
    dto: CreateDocumentDto,
    user: AuthUser,
  ): Promise<string> {
    if (!file) {
      throw new BadRequestException('file is required');
    }

    const documentId = randomUUID();
    const contentId = randomUUID();
    const originalName = file.originalname || 'uploaded-file';
    if (!this.fileParser.supports(originalName)) {
      throw new BadRequestException(
        'supported file types: pdf, xlsx, docx, pptx, txt, md',
      );
    }

    const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storageKey = `original/${documentId}/${safeName}`;
    const title =
      dto.title?.trim() || originalName.replace(extname(originalName), '');

    await this.storage.putObject(
      storageKey,
      file.buffer,
      file.mimetype || 'application/octet-stream',
    );

    try {
      const parsed = dto.markdown?.trim()
        ? {
            markdown: dto.markdown.trim() + '\n',
            assets: [],
            ready: true,
            parser: 'provided-markdown',
            warnings: [],
          }
        : await this.fileParser.parse(file.buffer, originalName, documentId);

      await this.contentStore.create({
        contentId,
        documentId,
        markdown: parsed.markdown,
        parser: parsed.parser,
        warnings: parsed.warnings,
        version: 1,
        assets: parsed.assets,
      });

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
        parseStatus: parsed.ready
          ? DocumentParseStatus.READY
          : parsed.error
            ? DocumentParseStatus.FAILED
            : DocumentParseStatus.PENDING,
        parseError: parsed.error ?? null,
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

      await this.documentRepository.save(document);
      return document.id;
    } catch (error) {
      await this.storage.removeObject(storageKey).catch(() => undefined);
      await this.contentStore
        .deleteByContentId(contentId)
        .catch(() => undefined);
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
