CREATE TABLE IF NOT EXISTS kh_index_head (
  document_id UUID NOT NULL,
  pipeline VARCHAR(16) NOT NULL CHECK (pipeline IN ('search', 'rag', 'kg')),
  generation UUID,
  version INTEGER NOT NULL CHECK (version > 0),
  deleted BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (document_id, pipeline),
  CHECK (NOT deleted OR generation IS NULL)
);

CREATE INDEX IF NOT EXISTS idx_kh_index_head_generation
  ON kh_index_head (generation) WHERE generation IS NOT NULL AND NOT deleted;
