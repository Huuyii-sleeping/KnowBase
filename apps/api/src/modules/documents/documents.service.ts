import { Injectable } from '@nestjs/common';
import { CreateDocumentDto } from './dto/create-document.dto';
import { ListDocumentsDto } from './dto/list-documents.dto';
import { ReviewDocumentDto } from './dto/review-document.dto';
import { UpdateContentDto } from './dto/update-content.dto';
import { UpdateDocumentDto } from './dto/update-document.dto';
import { DocumentCommandService } from './document-command.service';
import { DocumentQueryService } from './document-query.service';
import { DocumentWorkflowService } from './document-workflow.service';
import { DocumentPublishService } from './document-publish.service';
import { AuthUser } from '../auth/auth.types';

@Injectable()
export class DocumentsService {
  constructor(
    private readonly commandService: DocumentCommandService,
    private readonly queryService: DocumentQueryService,
    private readonly workflowService: DocumentWorkflowService,
    private readonly publishService: DocumentPublishService,
  ) {}

  async create(file: Express.Multer.File | undefined, dto: CreateDocumentDto, user: AuthUser) {
    const id = await this.commandService.create(file, dto, user);
    return this.queryService.findOneForUser(id, user, true);
  }

  findAll(query: ListDocumentsDto, user: AuthUser) {
    return this.queryService.findAll(query, user);
  }

  findOne(id: string, user: AuthUser) {
    return this.queryService.findOneForUser(id, user, true);
  }

  async update(id: string, dto: UpdateDocumentDto, user: AuthUser) {
    await this.commandService.updateMetadata(id, dto, user);
    return this.queryService.findOneForUser(id, user, true);
  }

  async updateContent(id: string, dto: UpdateContentDto, user: AuthUser) {
    await this.commandService.updateContent(id, dto, user);
    return this.queryService.findOneForUser(id, user, true);
  }

  async submitForReview(id: string, user: AuthUser) {
    await this.workflowService.submitForReview(id, user);
    return this.queryService.findOneForUser(id, user);
  }

  async review(id: string, dto: ReviewDocumentDto, user: AuthUser) {
    await this.workflowService.review(id, dto, user);
    if (dto.approved) {
      await this.publishService.dispatch(id, user);
    }
    return this.queryService.findOneForUser(id, user);
  }

  async publish(id: string, user: AuthUser) {
    await this.publishService.publish(id, user);
    return this.queryService.findOneForUser(id, user, true);
  }

  remove(id: string, user: AuthUser) {
    return this.commandService.remove(id, user);
  }
}
