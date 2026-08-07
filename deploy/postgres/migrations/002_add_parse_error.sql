ALTER TABLE kh_document
  ADD COLUMN IF NOT EXISTS parse_error TEXT;
