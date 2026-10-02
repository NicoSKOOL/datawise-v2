-- Internal Links (Jev) tool: one row per run. Bulky stage data (crawled
-- pages, candidates, judgements, report) lives in R2 under
-- internal-links/<run id>/ to keep D1 small; this row holds status,
-- progress and the run's small summary.
CREATE TABLE IF NOT EXISTS internal_link_runs (
  id                       TEXT PRIMARY KEY,
  user_id                  TEXT NOT NULL,
  site_url                 TEXT NOT NULL,
  sitemap_url              TEXT,
  status                   TEXT NOT NULL DEFAULT 'running',
  stage                    TEXT NOT NULL DEFAULT 'crawl',
  cursor                   INTEGER NOT NULL DEFAULT 0,
  total                    INTEGER NOT NULL DEFAULT 0,
  progress_json            TEXT,
  summary_json             TEXT,
  approvals_json           TEXT,
  cost_usd                 REAL NOT NULL DEFAULT 0,
  max_cost_usd             REAL NOT NULL DEFAULT 3,
  estimated_cost_usd       REAL,
  error                    TEXT,
  processing_locked_until  TEXT,
  created_at               TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at               TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at             TEXT
);
CREATE INDEX IF NOT EXISTS idx_internal_link_runs_user ON internal_link_runs(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_internal_link_runs_status ON internal_link_runs(status);
