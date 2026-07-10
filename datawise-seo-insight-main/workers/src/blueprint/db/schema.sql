-- Blueprint bootstrap schema. Full domain tables land in Phase 2.
CREATE TABLE IF NOT EXISTS blueprint_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO blueprint_meta (key, value) VALUES ('schema_version', '0')
  ON CONFLICT(key) DO NOTHING;
