-- Plans retain document snapshots even after the original document is deleted.
CREATE TABLE IF NOT EXISTS kh_index_upgrade_plan (
  id UUID PRIMARY KEY,
  created_by TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'preparing' CHECK (state IN ('preparing','preview','running','paused','completed','cancelled','preview_failed')),
  target JSONB NOT NULL,
  target_hash TEXT NOT NULL,
  scope JSONB NOT NULL,
  interval_ms INTEGER NOT NULL CHECK (interval_ms BETWEEN 100 AND 3600000),
  next_dispatch_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS kh_index_upgrade_item (
  id UUID PRIMARY KEY,
  plan_id UUID NOT NULL REFERENCES kh_index_upgrade_plan(id) ON DELETE CASCADE,
  document_id UUID NOT NULL,
  title TEXT NOT NULL,
  version INTEGER NOT NULL,
  content_id UUID NOT NULL,
  classification TEXT NOT NULL CHECK (classification IN ('rebuild','needs_reparse','missing_content','unpublished')),
  previous_strategy TEXT NOT NULL DEFAULT 'unknown',
  UNIQUE(plan_id, document_id)
);
CREATE TABLE IF NOT EXISTS kh_index_upgrade_task (
  id UUID PRIMARY KEY,
  item_id UUID NOT NULL REFERENCES kh_index_upgrade_item(id) ON DELETE CASCADE,
  pipeline TEXT NOT NULL CHECK (pipeline IN ('search','rag','kg')),
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','dispatched','running','succeeded','failed','skipped','activation_unknown')),
  dispatch_id UUID,
  event_id UUID,
  generation UUID,
  error_code TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(item_id, pipeline)
);
CREATE INDEX IF NOT EXISTS kh_upgrade_task_dispatch ON kh_index_upgrade_task(state,item_id);
CREATE INDEX IF NOT EXISTS kh_upgrade_item_page ON kh_index_upgrade_item(plan_id,id);
CREATE TABLE IF NOT EXISTS kh_index_upgrade_attempt (
  generation UUID PRIMARY KEY,
  task_id UUID NOT NULL REFERENCES kh_index_upgrade_task(id) ON DELETE CASCADE,
  dispatch_id UUID NOT NULL,
  event_id UUID NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('running','succeeded','failed','skipped','activation_unknown','interrupted')),
  error_code TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS kh_upgrade_attempt_task ON kh_index_upgrade_attempt(task_id,started_at);

CREATE INDEX IF NOT EXISTS kh_upgrade_plan_schedule ON kh_index_upgrade_plan(next_dispatch_at,created_at) WHERE state='running';
CREATE INDEX IF NOT EXISTS kh_upgrade_task_generation ON kh_index_upgrade_task(generation) WHERE generation IS NOT NULL;
