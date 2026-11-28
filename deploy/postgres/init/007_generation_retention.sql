CREATE TABLE IF NOT EXISTS kh_index_generation_retention (
  generation UUID PRIMARY KEY,
  document_id UUID NOT NULL,
  pipeline TEXT NOT NULL CHECK (pipeline IN ('search','rag','kg')),
  retired_at TIMESTAMPTZ,
  collected_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS kh_generation_retirement ON kh_index_generation_retention (retired_at)
  WHERE collected_at IS NULL AND retired_at IS NOT NULL;
