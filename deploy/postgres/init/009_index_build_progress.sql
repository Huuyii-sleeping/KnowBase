-- Attempt-scoped observability only; kh_index_head remains the visibility authority.
CREATE TABLE IF NOT EXISTS kh_index_build_progress (
  generation UUID PRIMARY KEY,
  document_id UUID NOT NULL REFERENCES kh_document(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version > 0),
  content_id UUID NOT NULL,
  pipeline TEXT NOT NULL CHECK (pipeline IN ('search', 'rag', 'kg')),
  state TEXT NOT NULL DEFAULT 'running' CHECK (state IN ('running','succeeded','failed','superseded','activation_unknown')),
  stage TEXT NOT NULL DEFAULT 'preparing' CHECK (stage IN ('preparing','content','chunk','embedding','graph_extract','index_write','activating','complete')),
  completed INTEGER NOT NULL DEFAULT 0 CHECK (completed >= 0),
  total INTEGER NOT NULL DEFAULT 0 CHECK (total >= completed),
  started_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_index_build_progress_document
  ON kh_index_build_progress(document_id, pipeline, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_index_build_progress_expiry
  ON kh_index_build_progress(updated_at);
