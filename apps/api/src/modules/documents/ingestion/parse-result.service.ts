import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Document, DocumentParseStatus } from '../entities/document.entity';
import { DocumentContentStore } from '../document-content.store';
import { ParseTaskStore } from './parse-task.store';
import {
  InvalidExtractionCheckpoint,
  ParseTask,
  ParseTaskSuperseded,
} from './parse-task.types';
import { ParsedDocument } from '../parsing/file-parser.types';

@Injectable()
export class ParseResultService {
  constructor(
    private readonly source: DataSource,
    private readonly content: DocumentContentStore,
    private readonly tasks: ParseTaskStore,
  ) {}

  async apply(task: ParseTask, result: ParsedDocument): Promise<void> {
    if (!task.checkpoint_content_id) await this.checkpoint(task, result);
    await this.content.verifyEvidence(task.content_id);
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
      const adopt = result.ready && !current.requires_review;
      if (adopt) {
        document.contentId = task.content_id;
        document.parseStatus = DocumentParseStatus.READY;
        document.parseError = null;
      } else if (!current.requires_review) {
        document.parseStatus = DocumentParseStatus.FAILED;
        document.parseError = 'Parsed draft requires manual review.';
      }
      await manager.save(Document, document);
      const state = adopt ? 'completed' : 'needs_review';
      await manager.query(
        `UPDATE kh_document_parse_task SET state=$2, stage=$2, lease_until=NULL,
        content_ids=CASE WHEN $4 THEN array_remove(content_ids,$3::uuid) ELSE content_ids END,
        updated_at=clock_timestamp(), finished_at=clock_timestamp(), error_code=NULL WHERE id=$1`,
        [task.id, state, task.content_id, adopt],
      );
    });
  }

  async checkpoint(task: ParseTask, result: ParsedDocument): Promise<void> {
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
      evidence: result.evidence,
      ready: result.ready,
      version:
        task.expected_version + (task.requires_review || !result.ready ? 1 : 0),
    });
    await this.tasks.checkpoint(task);
  }

  async resume(task: ParseTask): Promise<ParsedDocument> {
    const body = await this.content.findByContentId(
      task.checkpoint_content_id!,
    );
    if (!body || body.documentId !== task.document_id)
      throw new InvalidExtractionCheckpoint('Missing extraction checkpoint');
    try {
      await this.content.verifyEvidence(body.contentId);
    } catch (error) {
      if (
        error instanceof Error &&
        /integrity|incomplete|mismatched|missing|asset manifest/.test(
          error.message,
        )
      )
        throw new InvalidExtractionCheckpoint(error.message);
      throw error;
    }
    return {
      markdown: body.markdown,
      assets: body.assets.map((asset) => ({
        ...asset,
        type: asset.type === 'image' ? 'image' : 'attachment',
        url: asset.url ?? '',
      })),
      ready: body.ready ?? body.quality?.status === 'accepted',
      parser: body.parser,
      warnings: body.warnings,
      sections: body.sections,
      quality: body.quality,
      provenance: body.provenance,
      parseStrategy: body.parseStrategy,
    };
  }

  async discardIfUnreferenced(task: ParseTask): Promise<void> {
    // On an uncertain commit, a successful authoritative read is required before removal.
    const document = await this.source
      .getRepository(Document)
      .findOneBy({ id: task.document_id });
    if (document?.contentId === task.content_id) return;
    const current = await this.tasks.find(task.id);
    if (
      current?.checkpoint_content_id === task.content_id &&
      ['queued', 'running', 'needs_review'].includes(current.state)
    )
      return;
    await this.content.deleteByContentId(task.content_id);
  }
}
