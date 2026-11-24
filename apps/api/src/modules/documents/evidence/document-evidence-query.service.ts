import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Document } from '../entities/document.entity';
import { AuthUser } from '../../auth/auth.types';
import { DocumentAccessService } from '../../authorization/document-access.service';
import { DocumentContentStore } from '../document-content.store';
import { DocumentEvidenceStore } from './document-evidence.store';
import { ParseDraftService } from '../ingestion/parse-draft.service';

@Injectable()
export class DocumentEvidenceQueryService {
  constructor(
    @InjectRepository(Document)
    private readonly documents: Repository<Document>,
    private readonly access: DocumentAccessService,
    private readonly content: DocumentContentStore,
    private readonly evidence: DocumentEvidenceStore,
    private readonly drafts: ParseDraftService,
  ) {}
  async list(
    id: string,
    user: AuthUser,
    offsetText = '0',
    limitText = '20',
    taskId?: string,
  ) {
    if (
      taskId &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        taskId,
      )
    )
      throw new BadRequestException('Invalid draft task ID');
    const offset = Number(offsetText),
      limit = Number(limitText);
    if (
      !/^\d+$/.test(offsetText) ||
      !/^\d+$/.test(limitText) ||
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100
    )
      throw new BadRequestException('Invalid evidence pagination');
    const document = await this.documents.findOneBy({ id });
    if (!document) throw new NotFoundException('document not found');
    this.access.assertCanView(document, user);
    const body = taskId
      ? (await this.drafts.read(id, taskId, user)).body
      : await this.content.findByContentId(document.contentId);
    if (!body || body.documentId !== id)
      throw new NotFoundException('document content missing');
    return {
      contentId: body.contentId,
      total: body.evidenceManifest?.count ?? 0,
      offset,
      limit,
      items: await this.evidence.page(id, body.contentId, offset, limit),
    };
  }
}
