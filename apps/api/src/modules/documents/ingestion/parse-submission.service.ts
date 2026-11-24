import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { AuthUser } from '../../auth/auth.types';
import { DocumentAccessService } from '../../authorization/document-access.service';
import {
  Document,
  DocumentParseStatus,
  DocumentStatus,
} from '../entities/document.entity';
import { ParseTaskStore } from './parse-task.store';

@Injectable()
export class ParseSubmissionService {
  readonly enabled: boolean;
  constructor(
    private readonly source: DataSource,
    private readonly tasks: ParseTaskStore,
    private readonly access: DocumentAccessService,
    config: ConfigService,
  ) {
    const value = config.get<string | boolean>(
      'INGESTION_ASYNC_ENABLED',
      false,
    );
    this.enabled = value === true || value === 'true';
  }

  async create(document: Document): Promise<void> {
    await this.source.transaction(async (manager) => {
      await manager.save(Document, document);
      await this.tasks.create(manager, document);
    });
  }

  async reparse(id: string, user: AuthUser) {
    return this.source.transaction(async (manager) => {
      const document = await manager.findOne(Document, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!document) throw new NotFoundException('document not found');
      this.access.assertCanEdit(document, user);
      if (!this.enabled)
        throw new BadRequestException('Asynchronous ingestion is disabled');
      // Keep the adopted revision and visible generation while a candidate is built.
      const taskId = await this.tasks.create(manager, document, true);
      return { queued: true, taskId };
    });
  }

  async status(id: string, user: AuthUser) {
    const document = await this.source
      .getRepository(Document)
      .findOneBy({ id });
    if (!document) throw new NotFoundException('document not found');
    this.access.assertCanView(document, user);
    const task = await this.tasks.latest(id);
    return task
      ? {
          id: task.id,
          state: task.state,
          stage: task.stage,
          attempts: task.attempts,
          version: task.expected_version,
          errorCode: task.error_code,
          createdAt: task.created_at,
          updatedAt: task.updated_at,
          finishedAt: task.finished_at,
        }
      : null;
  }

  async cancel(id: string, user: AuthUser): Promise<void> {
    await this.source.transaction(async (manager) => {
      const document = await manager.findOne(Document, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!document) throw new NotFoundException('document not found');
      this.access.assertCanEdit(document, user);
      await this.tasks.invalidate(manager, id, 'canceled');
      if (document.parseStatus === DocumentParseStatus.PENDING) {
        document.parseStatus = DocumentParseStatus.FAILED;
        document.parseError =
          'Parsing canceled. Retry parsing or edit the content.';
        await manager.save(Document, document);
      }
    });
  }
}
