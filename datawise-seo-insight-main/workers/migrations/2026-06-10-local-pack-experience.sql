-- Local Pack Experience: review snapshots, cached review themes, geo-grid
-- competitor share. Additive only; safe to apply before the worker code that
-- references them. Apply to prod via the manual remote command (memory
-- feedback_prod_d1_migrations), never npm run db:migrate:production.

-- Daily review snapshot per local project, written on cache-miss reviews
-- fetches, at most one row per project per day (enforced in code).
CREATE TABLE IF NOT EXISTS local_review_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  rating REAL,
  reviews_count INTEGER,
  fetched_count INTEGER,
  responded_count INTEGER,
  response_rate INTEGER,
  unanswered_low_star INTEGER,
  rating_distribution TEXT,  -- JSON {"5":n,"4":n,...}
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_local_review_snapshots_project ON local_review_snapshots(project_id, created_at);

-- LLM review-theme analysis cache, keyed by project + SHA-256 of the review set.
CREATE TABLE IF NOT EXISTS local_review_themes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  reviews_hash TEXT NOT NULL,
  summary TEXT,
  themes TEXT,               -- JSON array
  model TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_local_review_themes_project ON local_review_themes(project_id, created_at);

-- Per-scan geo-grid competitor aggregation (top 10 by appearances).
CREATE TABLE IF NOT EXISTS geogrid_competitors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id TEXT NOT NULL,
  name TEXT NOT NULL,
  appearances INTEGER NOT NULL,   -- grid points where business appeared in top 3
  total_points INTEGER NOT NULL,
  avg_position REAL,
  best_position INTEGER,
  rating REAL,
  reviews INTEGER,
  is_user INTEGER NOT NULL DEFAULT 0,  -- 1 when the row is the project's own business
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_geogrid_competitors_scan ON geogrid_competitors(scan_id);
