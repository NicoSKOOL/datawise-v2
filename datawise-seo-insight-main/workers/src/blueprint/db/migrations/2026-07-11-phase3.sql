-- ===== Phase 3: SERP task tracking =====
CREATE TABLE IF NOT EXISTS dfs_serp_tasks (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES research_runs(id),
  keyword TEXT NOT NULL,
  service_area_id TEXT,
  location_code INTEGER NOT NULL,
  provider_task_id TEXT,
  status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','completed','failed')),
  posted_at TEXT NOT NULL,
  completed_at TEXT,
  snapshot_id TEXT,
  UNIQUE(run_id, keyword, location_code)
);
CREATE INDEX IF NOT EXISTS idx_dfs_serp_tasks_run ON dfs_serp_tasks(run_id, status);

UPDATE blueprint_meta SET value = '3', updated_at = datetime('now') WHERE key = 'schema_version' AND value < '3';
