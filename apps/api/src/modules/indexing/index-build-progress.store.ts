import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { Document } from '../documents/entities/document.entity';
import type { IndexPipeline } from './index-generation.store';

export const BUILD_STAGES = [
  'preparing',
  'content',
  'chunk',
  'embedding',
  'graph_extract',
  'index_write',
  'activating',
  'complete',
] as const;
export type BuildStage = (typeof BUILD_STAGES)[number];
export type BuildState =
  'running' | 'succeeded' | 'failed' | 'superseded' | 'activation_unknown';
export type BuildReporter = (
  stage: BuildStage,
  completed?: number,
  total?: number,
) => Promise<void>;

export interface IndexBuildAttempt {
  generation: string;
  pipeline: IndexPipeline;
  version: number;
  state: BuildState;
  stage: BuildStage;
  completed: number;
  total: number;
  started_at: Date;
  updated_at: Date;
  finished_at: Date | null;
}

@Injectable()
export class IndexBuildProgressStore {
  constructor(private readonly source: DataSource) {}
  async start(
    document: Document,
    pipeline: IndexPipeline,
    generation: string,
  ): Promise<void> {
    await this.source.query(
      `INSERT INTO kh_index_build_progress (generation,document_id,version,content_id,pipeline)
      SELECT $1,id,version,content_id,$2 FROM kh_document
      WHERE id=$3 AND version=$4 AND content_id=$5 AND status='PUBLISHED'
      ON CONFLICT (generation) DO NOTHING`,
      [generation, pipeline, document.id, document.version, document.contentId],
    );
  }
  async report(
    generation: string,
    stage: BuildStage,
    completed = 0,
    total = 0,
  ): Promise<void> {
    if (
      !BUILD_STAGES.includes(stage) ||
      !Number.isSafeInteger(completed) ||
      !Number.isSafeInteger(total) ||
      completed < 0 ||
      total < completed
    )
      throw new Error('Invalid index progress counters or stage');
    // An out-of-order callback cannot regress the phase or completed counter.
    await this.source.query(
      `UPDATE kh_index_build_progress SET stage=$2,
      completed=CASE WHEN stage=$2 THEN GREATEST(completed,$3) ELSE $3 END,
      total=CASE WHEN stage=$2 THEN GREATEST(total,$4) ELSE $4 END, updated_at=clock_timestamp()
      WHERE generation=$1 AND state='running'
      AND array_position($5::text[],stage)<=array_position($5::text[],$2)`,
      [generation, stage, completed, total, [...BUILD_STAGES]],
    );
  }
  async finish(
    generation: string,
    state: Exclude<BuildState, 'running'>,
  ): Promise<void> {
    await this.source.query(
      `UPDATE kh_index_build_progress SET state=$2,
      stage=CASE WHEN $2='succeeded' THEN 'complete' ELSE stage END,
      updated_at=clock_timestamp(),finished_at=clock_timestamp()
      WHERE generation=$1 AND state='running'`,
      [generation, state],
    );
  }
  async latest(documentId: string): Promise<IndexBuildAttempt[]> {
    return this.source.query<IndexBuildAttempt[]>(
      `SELECT DISTINCT ON (pipeline) generation,pipeline,version,state,stage,completed,total,
      started_at,updated_at,finished_at FROM kh_index_build_progress WHERE document_id=$1
      ORDER BY pipeline,started_at DESC,generation DESC`,
      [documentId],
    );
  }
  async prune(): Promise<void> {
    // Keep the latest run of each pipeline, including a long-unresolved process crash.
    await this.source
      .query(`DELETE FROM kh_index_build_progress p WHERE p.generation IN (
      SELECT r.generation FROM kh_index_build_progress r WHERE r.updated_at < clock_timestamp()-INTERVAL '30 days'
      AND EXISTS (SELECT 1 FROM kh_index_build_progress n WHERE n.document_id=r.document_id AND n.pipeline=r.pipeline
        AND (n.started_at,n.generation)>(r.started_at,r.generation)) LIMIT 200)`);
  }
}
