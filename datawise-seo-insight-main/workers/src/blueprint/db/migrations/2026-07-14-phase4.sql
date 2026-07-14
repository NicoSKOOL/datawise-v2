-- ===== Phase 4: clustering + page-planning schema =====
ALTER TABLE keywords ADD COLUMN excluded_reason TEXT;
ALTER TABLE keyword_clusters ADD COLUMN ruleset_version TEXT;
ALTER TABLE keyword_clusters ADD COLUMN score_breakdown_json TEXT;

CREATE TABLE IF NOT EXISTS cluster_adjudications (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES research_runs(id),
  case_type TEXT NOT NULL CHECK (case_type IN ('merge','split','intent_exception')),
  cluster_ids_json TEXT NOT NULL,
  keyword_ids_json TEXT NOT NULL,
  decision TEXT NOT NULL DEFAULT 'pending'
    CHECK (decision IN ('pending','insufficient_evidence','accepted','rejected')),
  score_context_json TEXT NOT NULL,
  ruleset_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_cluster_adjudications_run ON cluster_adjudications(run_id, decision);

CREATE TABLE IF NOT EXISTS parsed_competitor_pages (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  cluster_id TEXT NOT NULL,
  competitor_id TEXT,
  url TEXT NOT NULL,
  fetch_state TEXT NOT NULL CHECK (fetch_state IN ('parsed','empty','blocked','failed')),
  js_rendered INTEGER NOT NULL DEFAULT 0,
  status_code INTEGER,
  headings_json TEXT NOT NULL DEFAULT '[]',
  topics_json TEXT NOT NULL DEFAULT '[]',
  text_blocks_json TEXT NOT NULL DEFAULT '[]',
  links_json TEXT NOT NULL DEFAULT '[]',
  structure_json TEXT,
  evidence_ref_id TEXT,
  fetched_at TEXT NOT NULL,
  UNIQUE(run_id, cluster_id, url)
);
CREATE INDEX IF NOT EXISTS idx_parsed_pages_run ON parsed_competitor_pages(run_id, cluster_id);

CREATE TABLE IF NOT EXISTS existing_pages (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  url TEXT NOT NULL,
  canonical_url TEXT,
  title TEXT,
  discovered_via TEXT NOT NULL CHECK (discovered_via IN ('sitemap','robots','labs')),
  http_status INTEGER,
  matched_logical_page_id TEXT,
  match_score REAL,
  UNIQUE(run_id, url)
);
CREATE INDEX IF NOT EXISTS idx_existing_pages_run ON existing_pages(run_id);

CREATE INDEX IF NOT EXISTS idx_clusters_run ON keyword_clusters(run_id);
CREATE INDEX IF NOT EXISTS idx_cluster_keywords_kw ON cluster_keywords(keyword_id);

UPDATE blueprint_meta SET value = '4', updated_at = datetime('now')
  WHERE key = 'schema_version' AND CAST(value AS INTEGER) < 4;
