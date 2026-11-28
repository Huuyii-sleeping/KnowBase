import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuthUser } from '../../auth/auth.types';
import { DocumentAccessService } from '../../authorization/document-access.service';
import {
  Document,
  DocumentParseStatus,
  DocumentStatus,
} from '../entities/document.entity';
import { DocumentContentStore } from '../document-content.store';
import { ParseTaskStore } from './parse-task.store';
import { ParseTask } from './parse-task.types';
import { ReviewParseDto } from './review-parse.dto';

@Injectable()
export class ParseDraftService {
  constructor(
    private readonly source: DataSource,
    private readonly content: DocumentContentStore,
    private readonly tasks: ParseTaskStore,
    private readonly access: DocumentAccessService,
  ) {}

  async read(id: string, taskId: string, user: AuthUser) {
    const document = await this.source
      .getRepository(Document)
      .findOneBy({ id });
    if (!document) throw new NotFoundException('document not found');
    this.access.assertCanEdit(document, user);
    const task = await this.tasks.find(taskId);
    if (
      !task ||
      task.document_id !== id ||
      task.state !== 'needs_review' ||
      document.version !== task.expected_version ||
      document.contentId !== task.expected_content_id
    )
      throw new ConflictException('Parse draft is no longer current');
    const body = await this.content.findByContentId(task.content_id);
    if (!body || body.documentId !== id)
      throw new NotFoundException('parse draft missing');
    await this.content.verifyEvidence(body.contentId);
    return { task, body };
  }

  async review(id: string, dto: ReviewParseDto, user: AuthUser) {
    const { body } = await this.read(id, dto.taskId, user);
    if (!dto.note?.trim() || dto.note.trim().length < 3)
      throw new BadRequestException('Review note is required');
    if (dto.accept && body.ready !== true && !dto.acknowledgeIssues)
      throw new BadRequestException(
        'Acknowledge the extraction quality issues before adopting this draft',
      );
    await this.source.transaction(async (manager) => {
      const document = await manager.findOne(Document, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!document) throw new NotFoundException('document not found');
      this.access.assertCanEdit(document, user);
      const [task]: ParseTask[] = await manager.query(
        'SELECT * FROM kh_document_parse_task WHERE id=$1 FOR UPDATE',
        [dto.taskId],
      );
      if (
        !task ||
        task.document_id !== id ||
        task.state !== 'needs_review' ||
        task.content_id !== body.contentId ||
        document.version !== task.expected_version ||
        document.contentId !== task.expected_content_id
      )
        throw new ConflictException('Parse draft is no longer current');
      if (dto.accept) {
        document.contentId = task.content_id;
        document.version++;
        document.parseStatus = DocumentParseStatus.READY;
        document.parseError = null;
        document.status = DocumentStatus.DRAFT;
        document.rejectionReason = null;
        document.submittedAt = null;
        document.reviewedAt = null;
        document.reviewedBy = null;
        await manager.save(Document, document);
      } else await this.tasks.discard(manager, task);
      await manager.query(
        `UPDATE kh_document_parse_task SET state=$2, stage=$2, reviewed_by=$3, reviewed_at=clock_timestamp(), review_note=$4,
        content_ids=CASE WHEN $5 THEN array_remove(content_ids,content_id) ELSE content_ids END,
        updated_at=clock_timestamp() WHERE id=$1`,
        [
          task.id,
          dto.accept ? 'completed' : 'canceled',
          user.id,
          dto.note.trim(),
          dto.accept,
        ],
      );
    });
    return { accepted: dto.accept };
  }
}
