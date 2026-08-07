CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'kh_document_status_enum') THEN
    CREATE TYPE kh_document_status_enum AS ENUM ('DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'REJECTED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'kh_document_parse_status_enum') THEN
    CREATE TYPE kh_document_parse_status_enum AS ENUM ('PENDING', 'READY', 'FAILED');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS kh_document (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(255) NOT NULL,
  file_name VARCHAR(512) NOT NULL,
  mime_type VARCHAR(255) NOT NULL,
  file_size BIGINT NOT NULL DEFAULT 0,
  storage_key VARCHAR(1024) NOT NULL UNIQUE,
  content_id UUID NOT NULL,
  uploader_id VARCHAR(128) NOT NULL,
  category VARCHAR(128),
  team VARCHAR(128),
  tags TEXT[] NOT NULL DEFAULT '{}',
  status kh_document_status_enum NOT NULL DEFAULT 'DRAFT',
  parse_status kh_document_parse_status_enum NOT NULL DEFAULT 'PENDING',
  parse_error TEXT,
  rejection_reason TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
  statistics JSONB NOT NULL DEFAULT '{"viewCount": 0, "queryCount": 0}'::jsonb,
  submitted_at TIMESTAMPTZ,
  reviewed_at TIMESTAMPTZ,
  reviewed_by VARCHAR(128),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kh_document_status ON kh_document(status);
CREATE INDEX IF NOT EXISTS idx_kh_document_uploader_id ON kh_document(uploader_id);
CREATE INDEX IF NOT EXISTS idx_kh_document_category ON kh_document(category);
CREATE INDEX IF NOT EXISTS idx_kh_document_team ON kh_document(team);
CREATE INDEX IF NOT EXISTS idx_kh_document_created_at ON kh_document(created_at DESC);
