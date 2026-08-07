import { Injectable, NotFoundException } from '@nestjs/common';
import { Brackets, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { Document } from './entities/document.entity';
import { ListDocumentsDto } from './dto/list-documents.dto';
import { DocumentContentStore } from './document-content.store';

@Injectable()
export class DocumentQueryService {
  constructor(
    @InjectRepository(Document)
    private readonly documentRepository: Repository<Document>,
    private readonly contentStore: DocumentContentStore,
  ) {}

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
    const document = await this.findEntity(id);
    const content = includeContent
      ? await this.contentStore.findByContentId(document.contentId)
      : undefined;

    return {
      ...this.toMetadata(document),
      content: content
        ? {
            contentId: content.contentId,
            markdown: content.markdown,
            parser: content.parser,
            warnings: content.warnings,
            version: content.version,
            assets: content.assets,
            characterCount: content.characterCount,
          }
        : undefined,
    };
  }

  async findEntity(id: string): Promise<Document> {
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
      parseError: document.parseError,
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
}
