-- AI Engines v2: real ChatGPT/Gemini answers through one engine layer.
-- Adds per-check provenance (model, locale), the new `retrieved` evidence
-- (page fetched but not cited), citation kind, and named brand entities.
-- All additive. The pre-v2 worker ignores every column here.
--
-- Run BEFORE deploying the worker that writes them:
--   CLOUDFLARE_ACCOUNT_ID=510d0ac03a3a8f5ebeac39be4926ed77 \
--     npx wrangler d1 execute datawise-db --remote --file=migrations/2026-09-07-ai-engines-v2.sql

ALTER TABLE ai_visibility_checks ADD COLUMN model TEXT;
ALTER TABLE ai_visibility_checks ADD COLUMN location_code INTEGER;
ALTER TABLE ai_visibility_checks ADD COLUMN language_code TEXT;
ALTER TABLE ai_visibility_checks ADD COLUMN retrieved_url TEXT;

-- 'cited' (attributed source) or 'retrieved' (fetched during search, not cited).
ALTER TABLE ai_check_citations ADD COLUMN kind TEXT NOT NULL DEFAULT 'cited';

CREATE TABLE IF NOT EXISTS ai_check_brands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  check_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  category TEXT,
  is_you INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (check_id) REFERENCES ai_visibility_checks(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ai_check_brands_check ON ai_check_brands(check_id);
