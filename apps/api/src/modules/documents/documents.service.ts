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

@Injectable()
export class DocumentsService {
  constructor(
    private readonly commandService: DocumentCommandService,
    private readonly queryService: DocumentQueryService,
    private readonly workflowService: DocumentWorkflowService,
    private readonly publishService: DocumentPublishService,
  ) {}

  async create(file: Express.Multer.File | undefined, dto: CreateDocumentDto) {
    const id = await this.commandService.create(file, dto);
    return this.queryService.findOne(id, true);
  }

  findAll(query: ListDocumentsDto) {
    return this.queryService.findAll(query);
  }

  findOne(id: string) {
    return this.queryService.findOne(id, true);
  }

  async update(id: string, dto: UpdateDocumentDto) {
    await this.commandService.updateMetadata(id, dto);
    return this.queryService.findOne(id, true);
  }

  async updateContent(id: string, dto: UpdateContentDto) {
    await this.commandService.updateContent(id, dto);
    return this.queryService.findOne(id, true);
  }

  async submitForReview(id: string) {
    await this.workflowService.submitForReview(id);
    return this.queryService.findOne(id);
  }

  async review(id: string, dto: ReviewDocumentDto) {
    await this.workflowService.review(id, dto);
    if (dto.approved) {
      await this.publishService.dispatch(id);
    }
    return this.queryService.findOne(id);
  }

  async publish(id: string, reviewerId: string) {
    await this.publishService.publish(id, reviewerId);
    return this.queryService.findOne(id, true);
  }

  remove(id: string) {
    return this.commandService.remove(id);
  }
}
