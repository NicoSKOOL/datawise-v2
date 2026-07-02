-- app_events: request-level usage telemetry written by src/activity.ts
-- (recordRequestActivity, wired into the response finalizer in src/index.ts).
-- The table already exists in production D1 (created by hand around 2026-05-02)
-- but was never committed to version control, so a fresh database silently
-- drops every event (the insert failure is swallowed in activity.ts).
-- This migration is a no-op against production (IF NOT EXISTS everywhere)
-- and exists so the schema is reproducible from the repo.
-- DDL below matches the live table exactly (sqlite_master, 2026-07-02).

CREATE TABLE IF NOT EXISTS app_events (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  event_name TEXT NOT NULL,
  event_category TEXT NOT NULL CHECK (event_category IN ('product','admin','security','auth')),
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  session_id TEXT,
  request_id TEXT,
  feature TEXT NOT NULL,
  action TEXT NOT NULL,
  route TEXT,
  method TEXT,
  status_code INTEGER,
  outcome TEXT CHECK (outcome IN ('success','blocked','error')),
  resource_type TEXT,
  resource_id TEXT,
  property_id TEXT,
  credit_cost INTEGER DEFAULT 0,
  duration_ms INTEGER,
  error_code TEXT,
  metadata_json TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_app_events_created_at ON app_events(created_at);
CREATE INDEX IF NOT EXISTS idx_app_events_user_created ON app_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_events_feature_created ON app_events(feature, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_events_name_created ON app_events(event_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_events_category_created ON app_events(event_category, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_events_outcome_created ON app_events(outcome, created_at DESC);
