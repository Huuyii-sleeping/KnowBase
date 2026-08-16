import {
  Injectable,
  NotFoundException,
  Optional,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DocumentPipelinePublisher } from './document-pipeline.publisher';
import { Document, DocumentStatus } from './entities/document.entity';
import { AuthUser } from '../auth/auth.types';
import { DocumentAccessService } from '../authorization/document-access.service';

@Injectable()
export class DocumentPublishService {
  constructor(
    @InjectRepository(Document)
    private readonly documentRepository: Repository<Document>,
    private readonly pipelinePublisher: DocumentPipelinePublisher,
    @Optional() private readonly access?: DocumentAccessService,
  ) {}

  async publish(id: string, user: AuthUser): Promise<void> {
    this.access?.assertCanReview(user);
    const document = await this.findEntity(id);
    if (document.status !== DocumentStatus.PENDING_REVIEW) {
      throw new UnprocessableEntityException(
        'only pending documents can be published',
      );
    }

    document.status = DocumentStatus.PUBLISHED;
    document.rejectionReason = null;
    document.reviewedAt = new Date();
    document.reviewedBy = user.id;
    await this.documentRepository.save(document);

    await this.dispatch(id);
  }

  async dispatch(id: string, user?: AuthUser): Promise<void> {
    if (user) this.access?.assertCanReview(user);
    const document = await this.findEntity(id);
    if (document.status !== DocumentStatus.PUBLISHED) {
      throw new UnprocessableEntityException(
        'only published documents can dispatch pipeline messages',
      );
    }

    await this.pipelinePublisher.publishDocument(id);
  }

  private async findEntity(id: string): Promise<Document> {
    const document = await this.documentRepository.findOne({ where: { id } });
    if (!document) {
      throw new NotFoundException('document not found');
    }
    return document;
  }
}
