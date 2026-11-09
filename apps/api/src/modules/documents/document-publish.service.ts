import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { DocumentPipelinePublisher } from './document-pipeline.publisher';
import {
  Document,
  DocumentParseStatus,
  DocumentStatus,
} from './entities/document.entity';
import { AuthUser } from '../auth/auth.types';
import { DocumentAccessService } from '../authorization/document-access.service';

@Injectable()
export class DocumentPublishService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly pipelinePublisher: DocumentPipelinePublisher,
    private readonly access: DocumentAccessService,
  ) {}

  async publish(id: string, user: AuthUser): Promise<void> {
    this.access.assertCanReview(user);
    await this.dataSource.transaction(async (manager) => {
      const document = await this.lockDocument(manager, id);
      if (document.status !== DocumentStatus.PENDING_REVIEW) {
        throw new UnprocessableEntityException(
          'only pending documents can be published',
        );
      }
      if (document.parseStatus !== DocumentParseStatus.READY) {
        throw new UnprocessableEntityException('document parsing is not ready');
      }
      document.status = DocumentStatus.PUBLISHED;
      document.rejectionReason = null;
      document.reviewedAt = new Date();
      document.reviewedBy = user.id;
      await manager.save(Document, document);
      await this.pipelinePublisher.publishDocument(document, manager);
    });
  }

  async dispatch(id: string, user: AuthUser): Promise<void> {
    this.access.assertCanReview(user);
    await this.dataSource.transaction(async (manager) => {
      const document = await this.lockDocument(manager, id);
      if (document.status !== DocumentStatus.PUBLISHED) {
        throw new UnprocessableEntityException(
          'only published documents can dispatch pipeline messages',
        );
      }
      await this.pipelinePublisher.publishDocument(document, manager);
    });
  }

  private async lockDocument(
    manager: EntityManager,
    id: string,
  ): Promise<Document> {
    const document = await manager.findOne(Document, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!document) throw new NotFoundException('document not found');
    return document;
  }
}
