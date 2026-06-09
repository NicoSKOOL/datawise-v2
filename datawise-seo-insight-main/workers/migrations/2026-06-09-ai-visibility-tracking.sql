-- AI Visibility Tracker: persistent, scheduled tracking of AI search presence
-- (Google AI Mode, ChatGPT, Perplexity) per rank-tracking project.
-- Additive only — new columns are nullable/defaulted, new tables are empty.
-- Safe to apply before the worker code that references them.

ALTER TABLE seo_projects ADD COLUMN ai_tracking_enabled INTEGER DEFAULT 0;
ALTER TABLE seo_projects ADD COLUMN ai_brand_terms TEXT;
ALTER TABLE seo_projects ADD COLUMN ai_engines TEXT;

-- Queries checked against AI engines on the weekly run. source is 'keyword'
-- (mirrors a tracked_keywords row via keyword_id) or 'custom' (free-form
-- natural-language prompt). Max 10 active per project, enforced in the route.
CREATE TABLE IF NOT EXISTS ai_tracked_queries (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  query_text TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'custom',
  keyword_id TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES seo_projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ai_tracked_queries_project ON ai_tracked_queries(project_id);

-- One row per query x engine x run: the AI visibility time series.
-- status: cited | mentioned | absent | no_answer | error
CREATE TABLE IF NOT EXISTS ai_visibility_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query_id TEXT NOT NULL,
  engine TEXT NOT NULL,
  status TEXT NOT NULL,
  citation_position INTEGER,
  cited_url TEXT,
  answer_excerpt TEXT,
  run_type TEXT NOT NULL DEFAULT 'scheduled',
  checked_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (query_id) REFERENCES ai_tracked_queries(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ai_checks_query_engine ON ai_visibility_checks(query_id, engine, id);
CREATE INDEX IF NOT EXISTS idx_ai_checks_checked_at ON ai_visibility_checks(checked_at);

-- Every source cited in the answer (yours and competitors'), in citation
-- order. Powers share-of-voice without pre-declaring competitors.
CREATE TABLE IF NOT EXISTS ai_check_citations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  check_id INTEGER NOT NULL,
  domain TEXT NOT NULL,
  url TEXT,
  position INTEGER,
  FOREIGN KEY (check_id) REFERENCES ai_visibility_checks(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ai_citations_check ON ai_check_citations(check_id);
CREATE INDEX IF NOT EXISTS idx_ai_citations_domain ON ai_check_citations(domain);
