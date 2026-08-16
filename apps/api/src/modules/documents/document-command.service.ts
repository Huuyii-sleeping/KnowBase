import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StorageService } from '../storage/storage.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { UpdateContentDto } from './dto/update-content.dto';
import { UpdateDocumentDto } from './dto/update-document.dto';
import { Document, DocumentParseStatus, DocumentStatus } from './entities/document.entity';
import { FileParserService } from './parsing/file-parser.service';
import { DocumentContentStore } from './document-content.store';
import { AuthUser } from '../auth/auth.types';
import { DocumentAccessService, DocumentVisibility } from '../authorization/document-access.service';

@Injectable()
export class DocumentCommandService {
  constructor(
    @InjectRepository(Document)
    private readonly documentRepository: Repository<Document>,
    private readonly contentStore: DocumentContentStore,
    private readonly storage: StorageService,
    private readonly fileParser: FileParserService,
    @Optional() private readonly access?: DocumentAccessService,
  ) {}

  async create(file: Express.Multer.File | undefined, dto: CreateDocumentDto, user: AuthUser): Promise<string> {
    if (!file) {
      throw new BadRequestException('file is required');
    }

    const documentId = randomUUID();
    const contentId = randomUUID();
    const originalName = file.originalname || 'uploaded-file';
    if (!this.fileParser.supports(originalName)) {
      throw new BadRequestException('supported file types: pdf, xlsx, docx, pptx, txt, md');
    }

    const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storageKey = `original/${documentId}/${safeName}`;
    const title = dto.title?.trim() || originalName.replace(extname(originalName), '');

    await this.storage.putObject(storageKey, file.buffer, file.mimetype || 'application/octet-stream');

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
        tags: this.parseTags(dto.tags),
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
      await this.contentStore.deleteByContentId(contentId).catch(() => undefined);
      throw error;
    }
  }

  async updateMetadata(id: string, dto: UpdateDocumentDto, user?: AuthUser): Promise<void> {
    const document = await this.getEntity(id);
    if (user) this.access?.assertCanEdit(document, user);
    Object.assign(document, {
      ...(dto.title === undefined ? {} : { title: dto.title }),
      ...(dto.category === undefined ? {} : { category: dto.category }),
      ...(dto.team === undefined ? {} : { team: dto.team }),
      ...(dto.tags === undefined ? {} : { tags: this.parseTags(dto.tags) }),
      ...(dto.visibility === undefined
        ? {}
        : { permissions: { ...document.permissions, visibility: dto.visibility } }),
    });

    if (document.status === DocumentStatus.PUBLISHED) {
      document.status = DocumentStatus.DRAFT;
      document.rejectionReason = null;
      document.submittedAt = null;
      document.reviewedAt = null;
      document.reviewedBy = null;
    }
    await this.documentRepository.save(document);
  }

  async updateContent(id: string, dto: UpdateContentDto, user?: AuthUser): Promise<void> {
    const document = await this.getEntity(id);
    if (user) this.access?.assertCanEdit(document, user);
    const nextContentId = randomUUID();
    const nextVersion = document.version + 1;

    await this.contentStore.create({
      contentId: nextContentId,
      documentId: document.id,
      markdown: dto.markdown,
      parser: 'manual-markdown',
      warnings: [],
      version: nextVersion,
      assets: [],
    });

    document.contentId = nextContentId;
    document.version = nextVersion;
    document.parseStatus = DocumentParseStatus.READY;
    document.parseError = null;
    document.status = DocumentStatus.DRAFT;
    document.rejectionReason = null;
    document.submittedAt = null;
    document.reviewedAt = null;
    document.reviewedBy = null;

    try {
      await this.documentRepository.save(document);
    } catch (error) {
      await this.contentStore.deleteByContentId(nextContentId).catch(() => undefined);
      throw error;
    }
  }

  async remove(id: string, user?: AuthUser): Promise<void> {
    const document = await this.getEntity(id);
    if (user) this.access?.assertCanEdit(document, user);
    await this.contentStore.deleteByDocumentId(id);
    await this.documentRepository.delete(id);
    await this.storage.removeObject(document.storageKey).catch(() => undefined);
  }

  private async getEntity(id: string): Promise<Document> {
    const document = await this.documentRepository.findOne({ where: { id } });
    if (!document) {
      throw new NotFoundException('document not found');
    }
    return document;
  }

  private parseTags(raw?: string): string[] {
    if (!raw?.trim()) {
      return [];
    }
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map(String).map((tag) => tag.trim()).filter(Boolean);
      }
    } catch {
      return raw.split(',').map((tag) => tag.trim()).filter(Boolean);
    }
    return [];
  }
}
