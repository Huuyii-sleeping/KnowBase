import { BadRequestException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ReviewDocumentDto } from './dto/review-document.dto';
import { Document, DocumentParseStatus, DocumentStatus } from './entities/document.entity';

@Injectable()
export class DocumentWorkflowService {
  constructor(
    @InjectRepository(Document)
    private readonly documentRepository: Repository<Document>,
  ) {}

  async submitForReview(id: string): Promise<void> {
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
  }

  async review(id: string, dto: ReviewDocumentDto): Promise<void> {
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
  }

  private async getEntity(id: string): Promise<Document> {
    const document = await this.documentRepository.findOne({ where: { id } });
    if (!document) {
      throw new NotFoundException('document not found');
    }
    return document;
  }
}
