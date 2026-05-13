-- Admin-managed Content Writer prompt drafts, published overrides, and history.
-- Apply with: wrangler d1 execute datawise-db --file=migrations/2026-04-30-content-writer-prompts.sql

CREATE TABLE IF NOT EXISTS content_writer_prompt_configs (
  prompt_key TEXT PRIMARY KEY,
  draft_text TEXT,
  published_text TEXT,
  published_version INTEGER NOT NULL DEFAULT 0,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT,
  published_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  published_at TEXT
);

CREATE TABLE IF NOT EXISTS content_writer_prompt_versions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  prompt_key TEXT NOT NULL,
  version INTEGER NOT NULL,
  prompt_text TEXT NOT NULL,
  published_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  published_at TEXT DEFAULT (datetime('now')),
  UNIQUE(prompt_key, version)
);

CREATE INDEX IF NOT EXISTS idx_cwpv_prompt_version
  ON content_writer_prompt_versions(prompt_key, version DESC);
