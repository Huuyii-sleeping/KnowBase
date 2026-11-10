import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import {
  Document,
  DocumentStatus,
} from '../documents/entities/document.entity';

export type IndexPipeline = 'search' | 'rag' | 'kg';

@Injectable()
export class IndexGenerationStore {
  constructor(private readonly source: DataSource) {}

  async capture(id: string, version: number): Promise<Document | null> {
    if (!Number.isSafeInteger(version) || version <= 0)
      throw new BadRequestException(
        'index task requires a positive integer version',
      );
    const document = await this.source
      .getRepository(Document)
      .findOneBy({ id });
    if (
      !document ||
      document.status !== DocumentStatus.PUBLISHED ||
      document.version !== version
    )
      return null;
    return document;
  }

  async activate(
    document: Document,
    pipeline: IndexPipeline,
    generation: string,
  ): Promise<boolean> {
    return this.source.transaction(async (manager) => {
      // All document revisions, deletion and activation serialize on this row.
      const current = await manager.findOne(Document, {
        where: { id: document.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (
        !current ||
        current.status !== DocumentStatus.PUBLISHED ||
        current.version !== document.version ||
        current.contentId !== document.contentId
      )
        return false;
      const rows = await manager.query(
        `INSERT INTO kh_index_head (document_id, pipeline, generation, version)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (document_id, pipeline) DO UPDATE
         SET generation = EXCLUDED.generation, version = EXCLUDED.version, updated_at = clock_timestamp()
         WHERE NOT kh_index_head.deleted AND kh_index_head.version <= EXCLUDED.version
         RETURNING generation`,
        [document.id, pipeline, generation, document.version],
      );
      return rows.length === 1;
    });
  }

  async active(
    pipeline: IndexPipeline,
    allowedIds?: string[],
  ): Promise<string[]> {
    if (allowedIds?.length === 0) return [];
    const rows: { generation: string }[] = await this.source.query(
      `SELECT h.generation FROM kh_index_head h JOIN kh_document d ON d.id = h.document_id
       WHERE h.pipeline = $1 AND NOT h.deleted AND h.generation IS NOT NULL
         AND d.status = 'PUBLISHED' AND d.version = h.version
         ${allowedIds ? 'AND d.id = ANY($2::uuid[])' : ''}`,
      allowedIds ? [pipeline, allowedIds] : [pipeline],
    );
    return rows.map((row) => row.generation);
  }

  async tombstone(
    manager: EntityManager,
    id: string,
    version: number,
  ): Promise<void> {
    for (const pipeline of ['search', 'rag', 'kg']) {
      await manager.query(
        `INSERT INTO kh_index_head (document_id, pipeline, version, deleted)
         VALUES ($1, $2, $3, TRUE)
         ON CONFLICT (document_id, pipeline) DO UPDATE
         SET generation = NULL, deleted = TRUE, version = EXCLUDED.version, updated_at = clock_timestamp()`,
        [id, pipeline, version],
      );
    }
  }

  async isDeleted(id: string, pipeline: IndexPipeline): Promise<boolean> {
    const rows = await this.source.query(
      `SELECT 1 FROM kh_index_head h WHERE h.document_id = $1 AND h.pipeline = $2 AND h.deleted
       AND NOT EXISTS (SELECT 1 FROM kh_document d WHERE d.id = h.document_id)`,
      [id, pipeline],
    );
    return rows.length > 0;
  }
}
