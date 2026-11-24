ALTER TABLE kh_document_parse_task ADD COLUMN IF NOT EXISTS checkpoint_content_id UUID;
ALTER TABLE kh_document_parse_task ADD COLUMN IF NOT EXISTS requires_review BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE kh_document_parse_task ADD COLUMN IF NOT EXISTS reviewed_by VARCHAR(64);
ALTER TABLE kh_document_parse_task ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE kh_document_parse_task ADD COLUMN IF NOT EXISTS review_note TEXT;
