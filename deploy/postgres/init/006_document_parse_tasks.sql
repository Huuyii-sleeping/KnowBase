-- No FK cascade: deletion must retain task/asset references until cleanup completes.
CREATE TABLE IF NOT EXISTS kh_document_parse_task (
  id UUID PRIMARY KEY,
  document_id UUID NOT NULL,
  expected_version INTEGER NOT NULL,
  expected_content_id UUID NOT NULL,
  content_id UUID NOT NULL,
  content_ids UUID[] NOT NULL DEFAULT '{}',
  file_name TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  parser_config TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','running','completed','needs_review','failed','canceled','stale')),
  stage TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  run_id UUID,
  lease_until TIMESTAMPTZ,
  remote_task_id TEXT,
  remote_canceled BOOLEAN NOT NULL DEFAULT FALSE,
  assets JSONB NOT NULL DEFAULT '[]'::jsonb,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS kh_parse_task_document ON kh_document_parse_task (document_id, created_at DESC);
CREATE INDEX IF NOT EXISTS kh_parse_task_recovery ON kh_document_parse_task (lease_until) WHERE state = 'running';
CREATE UNIQUE INDEX IF NOT EXISTS kh_parse_task_active ON kh_document_parse_task (document_id) WHERE state IN ('queued','running');
