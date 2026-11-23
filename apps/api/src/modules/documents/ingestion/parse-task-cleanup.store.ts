import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

/** Queries only attempt-owned garbage; adopted document history is excluded. */
@Injectable()
export class ParseTaskCleanupStore {
  constructor(private readonly source: DataSource) {}

  async orphanContents(): Promise<
    Array<{ document_id: string; content_id: string }>
  > {
    return this.source
      .query(`SELECT t.document_id, candidate AS content_id FROM kh_document_parse_task t,
      LATERAL unnest(t.content_ids) AS candidate
      WHERE NOT EXISTS (SELECT 1 FROM kh_document d WHERE d.content_id=candidate)
        AND (t.state NOT IN ('queued','running') OR candidate<>t.content_id)
        AND t.updated_at < clock_timestamp()-INTERVAL '1 day'
      LIMIT 100`);
  }

  async forgetContent(documentId: string, contentId: string): Promise<void> {
    await this.source.query(
      'UPDATE kh_document_parse_task SET content_ids=array_remove(content_ids,$2::uuid) WHERE document_id=$1',
      [documentId, contentId],
    );
  }

  async remoteCancellations(
    fingerprint: string,
  ): Promise<Array<{ id: string; remote_task_id: string }>> {
    return this.source.query(
      `SELECT id,remote_task_id FROM kh_document_parse_task
      WHERE state IN ('canceled','stale','failed') AND remote_task_id IS NOT NULL AND NOT remote_canceled AND parser_config=$1 LIMIT 20`,
      [fingerprint],
    );
  }

  async remoteCanceled(id: string): Promise<void> {
    await this.source.query(
      'UPDATE kh_document_parse_task SET remote_canceled=TRUE WHERE id=$1',
      [id],
    );
  }
}
