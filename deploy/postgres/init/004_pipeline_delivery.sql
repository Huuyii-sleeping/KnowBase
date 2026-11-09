CREATE TABLE IF NOT EXISTS kh_pipeline_outbox (
  id UUID PRIMARY KEY,
  event_id VARCHAR(128) NOT NULL,
  routing_key VARCHAR(128) NOT NULL,
  body TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  publish_attempts INTEGER NOT NULL DEFAULT 0 CHECK (publish_attempts >= 0),
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (event_id, attempt)
);

CREATE INDEX IF NOT EXISTS idx_kh_pipeline_outbox_pending
  ON kh_pipeline_outbox (available_at, created_at, id) WHERE published_at IS NULL;

CREATE TABLE IF NOT EXISTS kh_pipeline_receipt (
  consumer VARCHAR(128) NOT NULL,
  event_id VARCHAR(128) NOT NULL,
  status VARCHAR(16) NOT NULL CHECK (status IN ('PENDING', 'COMPLETED', 'RETRY', 'DEAD')),
  attempt INTEGER NOT NULL DEFAULT -1 CHECK (attempt >= -1),
  last_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (consumer, event_id)
);
