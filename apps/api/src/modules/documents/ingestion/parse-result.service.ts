import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Document, DocumentParseStatus } from '../entities/document.entity';
import { DocumentContentStore } from '../document-content.store';
import { ParseTaskStore } from './parse-task.store';
import { ParseTask, ParseTaskSuperseded } from './parse-task.types';
import { ParsedDocument } from '../parsing/file-parser.types';

@Injectable()
export class ParseResultService {
  constructor(
    private readonly source: DataSource,
    private readonly content: DocumentContentStore,
    private readonly tasks: ParseTaskStore,
  ) {}

  async apply(task: ParseTask, result: ParsedDocument): Promise<void> {
    // Immutable body first; the short PostgreSQL transaction publishes its pointer.
    await this.content.create({
      contentId: task.content_id,
      documentId: task.document_id,
      markdown: result.markdown,
      parser: result.parser,
      warnings: result.warnings,
      assets: result.assets,
      sections: result.sections,
      parseStrategy: result.parseStrategy,
      quality: result.quality,
      provenance: result.provenance,
      version: task.expected_version,
    });
    await this.source.transaction(async (manager) => {
      const document = await manager.findOne(Document, {
        where: { id: task.document_id },
        lock: { mode: 'pessimistic_write' },
      });
      const [current]: ParseTask[] = await manager.query(
        'SELECT * FROM kh_document_parse_task WHERE id=$1 FOR UPDATE',
        [task.id],
      );
      if (
        !document ||
        !current ||
        current.state !== 'running' ||
        current.run_id !== task.run_id ||
        document.version !== task.expected_version ||
        document.contentId !== task.expected_content_id
      )
        throw new ParseTaskSuperseded();
      document.contentId = task.content_id;
      document.parseStatus = result.ready
        ? DocumentParseStatus.READY
        : DocumentParseStatus.FAILED;
      document.parseError = result.ready
        ? null
        : 'Parsed content requires manual review.';
      await manager.save(Document, document);
      const state = result.ready ? 'completed' : 'needs_review';
      await manager.query(
        `UPDATE kh_document_parse_task SET state=$2, stage=$2, lease_until=NULL,
        content_ids=array_remove(content_ids,$3::uuid),
        updated_at=clock_timestamp(), finished_at=clock_timestamp(), error_code=NULL WHERE id=$1`,
        [task.id, state, task.content_id],
      );
    });
  }

  async discardIfUnreferenced(task: ParseTask): Promise<void> {
    // On an uncertain commit, a successful authoritative read is required before removal.
    const document = await this.source
      .getRepository(Document)
      .findOneBy({ id: task.document_id });
    if (document?.contentId === task.content_id) return;
    await this.content.deleteByContentId(task.content_id);
  }
}
