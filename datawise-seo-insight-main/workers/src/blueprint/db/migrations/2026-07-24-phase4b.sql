-- ===== Phase 4b: page-plan v3 schema (schema_version 5) =====

-- 3.7/D6: per-page supporting keyword list.
ALTER TABLE blueprint_pages ADD COLUMN supporting_keywords_json TEXT;

-- 3.4: out-of-area exclusion reason. keywords.excluded_reason was created
-- CHECK-free in the Phase 4 migration, so 'out_of_area' is already an allowed
-- value and needs no DDL here (staying consistent with that column's style).

-- 3.5: the adjudicator gains a 'variant_fold' case_type and records who resolved
-- each case. case_type carries a CHECK constraint, and SQLite cannot widen a
-- CHECK in place, so this rebuilds the table (create-copy-drop-rename) and adds
-- the nullable resolved_by column at the same time.
PRAGMA foreign_keys=OFF;
CREATE TABLE cluster_adjudications_new (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES research_runs(id),
  case_type TEXT NOT NULL CHECK (case_type IN ('merge','split','intent_exception','variant_fold')),
  cluster_ids_json TEXT NOT NULL,
  keyword_ids_json TEXT NOT NULL,
  decision TEXT NOT NULL DEFAULT 'pending'
    CHECK (decision IN ('pending','insufficient_evidence','accepted','rejected')),
  score_context_json TEXT NOT NULL,
  ruleset_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  resolved_by TEXT CHECK (resolved_by IS NULL OR resolved_by IN ('rules','llm'))
);
INSERT INTO cluster_adjudications_new
  (id, run_id, case_type, cluster_ids_json, keyword_ids_json, decision, score_context_json, ruleset_version, created_at, resolved_at)
  SELECT id, run_id, case_type, cluster_ids_json, keyword_ids_json, decision, score_context_json, ruleset_version, created_at, resolved_at
  FROM cluster_adjudications;
DROP TABLE cluster_adjudications;
ALTER TABLE cluster_adjudications_new RENAME TO cluster_adjudications;
CREATE INDEX IF NOT EXISTS idx_cluster_adjudications_run ON cluster_adjudications(run_id, decision);
PRAGMA foreign_keys=ON;

UPDATE blueprint_meta SET value = '5', updated_at = datetime('now')
  WHERE key = 'schema_version' AND CAST(value AS INTEGER) < 5;
