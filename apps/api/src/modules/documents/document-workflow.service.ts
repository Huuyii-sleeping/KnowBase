import { BadRequestException, Injectable, NotFoundException, Optional, UnprocessableEntityException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ReviewDocumentDto } from './dto/review-document.dto';
import { Document, DocumentParseStatus, DocumentStatus } from './entities/document.entity';
import { AuthUser } from '../auth/auth.types';
import { DocumentAccessService } from '../authorization/document-access.service';

@Injectable()
export class DocumentWorkflowService {
  constructor(
    @InjectRepository(Document)
    private readonly documentRepository: Repository<Document>,
    @Optional() private readonly access?: DocumentAccessService,
  ) {}

  async submitForReview(id: string, user?: AuthUser): Promise<void> {
    const document = await this.getEntity(id);
    if (user) this.access?.assertCanEdit(document, user);
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
  }

  async review(id: string, dto: ReviewDocumentDto, user?: AuthUser): Promise<void> {
    if (user) this.access?.assertCanReview(user);
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
    document.reviewedBy = user?.id ?? 'system';
    await this.documentRepository.save(document);
  }

  private async getEntity(id: string): Promise<Document> {
    const document = await this.documentRepository.findOne({ where: { id } });
    if (!document) {
      throw new NotFoundException('document not found');
    }
    return document;
  }
}
