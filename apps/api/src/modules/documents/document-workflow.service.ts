import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ReviewDocumentDto } from './dto/review-document.dto';
import {
  Document,
  DocumentParseStatus,
  DocumentStatus,
} from './entities/document.entity';
import { AuthUser } from '../auth/auth.types';
import { DocumentAccessService } from '../authorization/document-access.service';
import { DocumentPublishService } from './document-publish.service';

@Injectable()
export class DocumentWorkflowService {
  constructor(
    private readonly source: DataSource,
    private readonly publishService: DocumentPublishService,
    @Optional() private readonly access?: DocumentAccessService,
  ) {}

  async submitForReview(id: string, user?: AuthUser): Promise<void> {
    await this.source.transaction(async (manager) => {
      const document = await this.getEntity(manager, id);
      if (user) this.access?.assertCanEdit(document, user);
      if (
        ![DocumentStatus.DRAFT, DocumentStatus.REJECTED].includes(
          document.status,
        )
      ) {
        throw new UnprocessableEntityException(
          'only draft or rejected documents can be submitted',
        );
      }
      if (document.parseStatus !== DocumentParseStatus.READY) {
        throw new UnprocessableEntityException('document parsing is not ready');
      }

      document.status = DocumentStatus.PENDING_REVIEW;
      document.submittedAt = new Date();
      document.rejectionReason = null;
      await manager.save(Document, document);
    });
  }

  async review(
    id: string,
    dto: ReviewDocumentDto,
    user?: AuthUser,
  ): Promise<void> {
    if (dto.approved) {
      if (!user)
        throw new BadRequestException(
          'publication requires an authenticated reviewer',
        );
      await this.publishService.publish(id, user);
      return;
    }
    if (user) this.access?.assertCanReview(user);
    await this.source.transaction(async (manager) => {
      const document = await this.getEntity(manager, id);
      if (document.status !== DocumentStatus.PENDING_REVIEW) {
        throw new UnprocessableEntityException(
          'only pending documents can be reviewed',
        );
      }
      if (!dto.approved && !dto.reason?.trim()) {
        throw new BadRequestException(
          'reason is required when rejecting a document',
        );
      }

      document.status = DocumentStatus.REJECTED;
      document.rejectionReason = dto.reason!.trim();
      document.reviewedAt = new Date();
      document.reviewedBy = user?.id ?? 'system';
      await manager.save(Document, document);
    });
  }

  private async getEntity(
    manager: EntityManager,
    id: string,
  ): Promise<Document> {
    const document = await manager.findOne(Document, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!document) {
      throw new NotFoundException('document not found');
    }
    return document;
  }
}
