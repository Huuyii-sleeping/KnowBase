import { ParsedAsset } from '../parsing/file-parser.types';

export type ParseTaskState =
  | 'queued'
  | 'running'
  | 'completed'
  | 'needs_review'
  | 'failed'
  | 'canceled'
  | 'stale';
export interface ParseTask {
  id: string;
  document_id: string;
  expected_version: number;
  expected_content_id: string;
  content_id: string;
  content_ids: string[];
  file_name: string;
  storage_key: string;
  parser_config: string;
  state: ParseTaskState;
  stage: string;
  attempts: number;
  run_id: string | null;
  lease_until: Date | null;
  remote_task_id: string | null;
  assets: ParsedAsset[];
  error_code: string | null;
  created_at: Date;
  updated_at: Date;
  finished_at: Date | null;
}

export class ParseTaskSuperseded extends Error {
  constructor() {
    super('Parse task no longer owns the document');
  }
}
