import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { Model } from 'mongoose';
import { extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { StorageService } from '../storage/storage.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { ListDocumentsDto } from './dto/list-documents.dto';
import { ReviewDocumentDto } from './dto/review-document.dto';
import { UpdateContentDto } from './dto/update-content.dto';
import { UpdateDocumentDto } from './dto/update-document.dto';
import {
  Document,
  DocumentParseStatus,
  DocumentStatus,
} from './entities/document.entity';
import { DocumentContent, DocumentContentDocument } from './schemas/document-content.schema';

interface ParsedMarkdown {
  markdown: string;
  ready: boolean;
}

@Injectable()
export class DocumentsService {
  constructor(
    @InjectRepository(Document)
    private readonly documentRepository: Repository<Document>,
    @InjectModel(DocumentContent.name)
    private readonly contentModel: Model<DocumentContentDocument>,
    private readonly storage: StorageService,
  ) {}

  async create(file: Express.Multer.File | undefined, dto: CreateDocumentDto) {
    if (!file) {
      throw new BadRequestException('file is required');
    }

    const documentId = randomUUID();
    const contentId = randomUUID();
    const originalName = file.originalname || 'uploaded-file';
    const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storageKey = `original/${documentId}/${safeName}`;
    const title = dto.title?.trim() || originalName.replace(extname(originalName), '');
    const parsed = this.toMarkdown(file, title, dto.markdown);

    await this.storage.putObject(storageKey, file.buffer, file.mimetype || 'application/octet-stream');

    try {
      await new this.contentModel({
        contentId,
        documentId,
        markdown: parsed.markdown,
        version: 1,
        assets: [],
        characterCount: parsed.markdown.length,
      }).save();

      const document = this.documentRepository.create({
        id: documentId,
        title,
        fileName: originalName,
        mimeType: file.mimetype || 'application/octet-stream',
        fileSize: file.size,
        storageKey,
        contentId,
        uploaderId: dto.uploaderId,
        category: dto.category ?? null,
        team: dto.team ?? null,
        tags: this.parseTags(dto.tags),
        status: DocumentStatus.DRAFT,
        parseStatus: parsed.ready ? DocumentParseStatus.READY : DocumentParseStatus.PENDING,
        rejectionReason: null,
        version: 1,
        permissions: {},
        statistics: { viewCount: 0, queryCount: 0 },
        submittedAt: null,
        reviewedAt: null,
        reviewedBy: null,
      });

      await this.documentRepository.save(document);
      return this.findOne(documentId, true);
    } catch (error) {
      await this.storage.removeObject(storageKey).catch(() => undefined);
      await this.contentModel.deleteOne({ contentId }).catch(() => undefined);
      throw error;
    }
  }

  async findAll(query: ListDocumentsDto) {
    const builder = this.documentRepository.createQueryBuilder('document');

    if (query.keyword) {
      builder.andWhere(
        new Brackets((where) => {
          where
            .where('document.title ILIKE :keyword', { keyword: `%${query.keyword}%` })
            .orWhere('document.fileName ILIKE :keyword', { keyword: `%${query.keyword}%` });
        }),
      );
    }
    if (query.status) {
      builder.andWhere('document.status = :status', { status: query.status });
    }
    if (query.category) {
      builder.andWhere('document.category = :category', { category: query.category });
    }

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const [items, total] = await builder
      .orderBy('document.createdAt', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();

    return {
      items: items.map((item) => this.toMetadata(item)),
      page,
      pageSize,
      total,
    };
  }

  async findOne(id: string, includeContent = false) {
    const document = await this.documentRepository.findOne({ where: { id } });
    if (!document) {
      throw new NotFoundException('document not found');
    }

    const content = includeContent
      ? await this.contentModel.findOne({ contentId: document.contentId }).lean().exec()
      : undefined;

    return {
      ...this.toMetadata(document),
      content: content
        ? {
            contentId: content.contentId,
            markdown: content.markdown,
            version: content.version,
            assets: content.assets,
            characterCount: content.characterCount,
          }
        : undefined,
    };
  }

  async update(id: string, dto: UpdateDocumentDto) {
    const document = await this.getEntity(id);
    Object.assign(document, {
      ...(dto.title === undefined ? {} : { title: dto.title }),
      ...(dto.category === undefined ? {} : { category: dto.category }),
      ...(dto.team === undefined ? {} : { team: dto.team }),
      ...(dto.tags === undefined ? {} : { tags: this.parseTags(dto.tags) }),
    });

    if (document.status === DocumentStatus.PUBLISHED) {
      document.status = DocumentStatus.DRAFT;
      document.rejectionReason = null;
      document.submittedAt = null;
      document.reviewedAt = null;
      document.reviewedBy = null;
    }

    await this.documentRepository.save(document);
    return this.findOne(id, true);
  }

  async updateContent(id: string, dto: UpdateContentDto) {
    const document = await this.getEntity(id);
    const nextContentId = randomUUID();
    const nextVersion = document.version + 1;

    await new this.contentModel({
      contentId: nextContentId,
      documentId: document.id,
      markdown: dto.markdown,
      version: nextVersion,
      assets: [],
      characterCount: dto.markdown.length,
    }).save();

    document.contentId = nextContentId;
    document.version = nextVersion;
    document.parseStatus = DocumentParseStatus.READY;
    document.status = DocumentStatus.DRAFT;
    document.rejectionReason = null;
    document.submittedAt = null;
    document.reviewedAt = null;
    document.reviewedBy = null;

    try {
      await this.documentRepository.save(document);
    } catch (error) {
      await this.contentModel.deleteOne({ contentId: nextContentId }).catch(() => undefined);
      throw error;
    }

    return this.findOne(id, true);
  }

  async submitForReview(id: string) {
    const document = await this.getEntity(id);
    if (![DocumentStatus.DRAFT, DocumentStatus.REJECTED].includes(document.status)) {
      throw new UnprocessableEntityException('only draft or rejected documents can be submitted');
    }
    if (document.parseStatus !== DocumentParseStatus.READY) {
      throw new UnprocessableEntityException('document parsing is not ready');
    }

    document.status = DocumentStatus.PENDING_REVIEW;
    document.submittedAt = new Date();
    document.rejectionReason = null;
    await this.documentRepository.save(document);
    return this.findOne(id);
  }

  async review(id: string, dto: ReviewDocumentDto) {
    const document = await this.getEntity(id);
    if (document.status !== DocumentStatus.PENDING_REVIEW) {
      throw new UnprocessableEntityException('only pending documents can be reviewed');
    }
    if (!dto.approved && !dto.reason?.trim()) {
      throw new BadRequestException('reason is required when rejecting a document');
    }

    document.status = dto.approved ? DocumentStatus.PUBLISHED : DocumentStatus.REJECTED;
    document.rejectionReason = dto.approved ? null : dto.reason!.trim();
    document.reviewedAt = new Date();
    document.reviewedBy = dto.reviewerId;
    await this.documentRepository.save(document);
    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    const document = await this.getEntity(id);
    await this.contentModel.deleteMany({ documentId: id });
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

  private toMetadata(document: Document) {
    return {
      id: document.id,
      title: document.title,
      fileName: document.fileName,
      mimeType: document.mimeType,
      fileSize: Number(document.fileSize),
      storageKey: document.storageKey,
      contentId: document.contentId,
      uploaderId: document.uploaderId,
      category: document.category,
      team: document.team,
      tags: document.tags,
      status: document.status,
      parseStatus: document.parseStatus,
      rejectionReason: document.rejectionReason,
      version: document.version,
      permissions: document.permissions,
      statistics: document.statistics,
      submittedAt: document.submittedAt,
      reviewedAt: document.reviewedAt,
      reviewedBy: document.reviewedBy,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
    };
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

  private toMarkdown(file: Express.Multer.File, title: string, suppliedMarkdown?: string): ParsedMarkdown {
    if (suppliedMarkdown?.trim()) {
      return { markdown: suppliedMarkdown, ready: true };
    }

    const extension = extname(file.originalname).toLowerCase();
    if (extension === '.md' || file.mimetype === 'text/markdown') {
      return { markdown: file.buffer.toString('utf8'), ready: true };
    }
    if (extension === '.txt' || file.mimetype === 'text/plain') {
      return { markdown: `# ${title}\n\n${file.buffer.toString('utf8')}`, ready: true };
    }

    return {
      markdown: [
        `# ${title}`,
        '',
        `- Original file: ${file.originalname}`,
        `- MIME type: ${file.mimetype || 'application/octet-stream'}`,
        '',
        '> Media parsing is pending. Provide normalized Markdown from the ingestion worker before review.',
      ].join('\n'),
      ready: false,
    };
  }
}
