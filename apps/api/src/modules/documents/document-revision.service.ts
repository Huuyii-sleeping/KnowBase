import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { randomUUID } from 'node:crypto';
import {
  Document,
  DocumentParseStatus,
  DocumentStatus,
} from './entities/document.entity';
import { DocumentContentStore } from './document-content.store';
import { DocumentAccessService } from '../authorization/document-access.service';
import { AuthUser } from '../auth/auth.types';
import { UpdateContentDto } from './dto/update-content.dto';
import { UpdateDocumentDto } from './dto/update-document.dto';
import { parseDocumentTags } from './document-tags.util';

@Injectable()
export class DocumentRevisionService {
  constructor(
    private readonly source: DataSource,
    private readonly content: DocumentContentStore,
    private readonly access: DocumentAccessService,
  ) {}

  async updateMetadata(
    id: string,
    dto: UpdateDocumentDto,
    user?: AuthUser,
  ): Promise<void> {
    await this.source.transaction(async (manager) => {
      const document = await this.lock(manager, id, user);
      const patch = {
        ...(dto.title === undefined ? {} : { title: dto.title }),
        ...(dto.category === undefined ? {} : { category: dto.category }),
        ...(dto.team === undefined ? {} : { team: dto.team }),
        ...(dto.tags === undefined
          ? {}
          : { tags: parseDocumentTags(dto.tags) }),
        ...(dto.visibility === undefined
          ? {}
          : {
              permissions: {
                ...document.permissions,
                visibility: dto.visibility,
              },
            }),
      };
      if (
        !Object.entries(patch).some(
          ([key, value]) =>
            JSON.stringify(document[key as keyof Document]) !==
            JSON.stringify(value),
        )
      )
        return;
      Object.assign(document, patch);
      document.version++;
      this.resetReview(document);
      await manager.save(Document, document);
    });
  }

  async updateContent(
    id: string,
    dto: UpdateContentDto,
    user?: AuthUser,
  ): Promise<void> {
    const contentId = randomUUID();
    try {
      await this.source.transaction(async (manager) => {
        const document = await this.lock(manager, id, user);
        await this.content.create({
          contentId,
          documentId: id,
          markdown: dto.markdown,
          parser: 'manual-markdown',
          warnings: [],
          assets: [],
          version: document.version + 1,
        });
        document.contentId = contentId;
        document.version++;
        document.parseStatus = DocumentParseStatus.READY;
        document.parseError = null;
        this.resetReview(document);
        await manager.save(Document, document);
      });
    } catch (error) {
      // Preserve content if the COMMIT outcome cannot be established.
      try {
        const current = await this.source
          .getRepository(Document)
          .findOneBy({ id });
        if (current?.contentId !== contentId)
          await this.content.deleteByContentId(contentId);
      } catch {
        /* Leave recoverable content for reconciliation. */
      }
      throw error;
    }
  }

  private async lock(
    manager: EntityManager,
    id: string,
    user?: AuthUser,
  ): Promise<Document> {
    const document = await manager.findOne(Document, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!document) throw new NotFoundException('document not found');
    if (user) this.access.assertCanEdit(document, user);
    return document;
  }

  private resetReview(document: Document): void {
    document.status = DocumentStatus.DRAFT;
    document.rejectionReason = null;
    document.submittedAt = null;
    document.reviewedAt = null;
    document.reviewedBy = null;
  }
}
