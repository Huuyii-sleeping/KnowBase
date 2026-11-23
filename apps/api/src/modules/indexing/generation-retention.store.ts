import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { IndexPipeline } from './index-generation.store';

@Injectable()
export class GenerationRetentionStore {
  constructor(private readonly source: DataSource) {}

  async activated(
    manager: EntityManager,
    documentId: string,
    pipeline: IndexPipeline,
    generation: string,
  ): Promise<void> {
    // Called in the same transaction as pointer activation. Grace starts when
    // the previous generation loses visibility, not when it was first built.
    await manager.query(
      `UPDATE kh_index_generation_retention SET retired_at=clock_timestamp()
      WHERE document_id=$1 AND pipeline=$2 AND generation<>$3 AND retired_at IS NULL`,
      [documentId, pipeline, generation],
    );
    await manager.query(
      `INSERT INTO kh_index_generation_retention (generation,document_id,pipeline)
      VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
      [generation, documentId, pipeline],
    );
  }

  async deleted(manager: EntityManager, documentId: string): Promise<void> {
    await manager.query(
      `UPDATE kh_index_generation_retention SET retired_at=COALESCE(retired_at,clock_timestamp())
      WHERE document_id=$1`,
      [documentId],
    );
  }

  async candidates(
    retentionMs: number,
  ): Promise<
    Array<{ generation: string; document_id: string; pipeline: IndexPipeline }>
  > {
    return this.source.query(
      `SELECT r.generation,r.document_id,r.pipeline FROM kh_index_generation_retention r
      WHERE r.retired_at < clock_timestamp()-$1*INTERVAL '1 millisecond' AND r.collected_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM kh_index_head h WHERE h.generation=r.generation)
      ORDER BY r.retired_at LIMIT 50`,
      [retentionMs],
    );
  }

  async collect(
    generation: string,
    cleanup: () => Promise<void>,
  ): Promise<void> {
    await this.source.transaction(async (manager) => {
      const [row] = await manager.query(
        `SELECT generation FROM kh_index_generation_retention
        WHERE generation=$1 AND retired_at IS NOT NULL AND collected_at IS NULL FOR UPDATE SKIP LOCKED`,
        [generation],
      );
      if (!row) return;
      const head = await manager.query(
        'SELECT 1 FROM kh_index_head WHERE generation=$1',
        [generation],
      );
      if (head.length) return;
      // This registry includes only committed activations. Uncertain or in-flight
      // stages are not candidates and cannot race this completed lifecycle.
      await cleanup();
      await manager.query(
        'UPDATE kh_index_generation_retention SET collected_at=clock_timestamp() WHERE generation=$1',
        [generation],
      );
    });
  }
}
