-- Blueprint bootstrap schema. Full domain tables land in Phase 2.
CREATE TABLE IF NOT EXISTS blueprint_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO blueprint_meta (key, value) VALUES ('schema_version', '0')
  ON CONFLICT(key) DO NOTHING;

-- ===== Phase 2: identity/project =====
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('greenfield','existing_site')),
  website_domain TEXT,
  country_iso TEXT NOT NULL,
  language_code TEXT NOT NULL,
  active_brief_version_id TEXT,
  latest_run_id TEXT,
  latest_blueprint_version_id TEXT,
  latest_blueprint_revision_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_projects_org ON projects(organization_id, deleted_at);

CREATE TABLE IF NOT EXISTS project_brief_versions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  version_number INTEGER NOT NULL,
  input_json TEXT NOT NULL,
  normalized_json TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(project_id, version_number)
);

CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY,
  brief_version_id TEXT NOT NULL REFERENCES project_brief_versions(id),
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  description TEXT,
  priority TEXT NOT NULL CHECK (priority IN ('primary','secondary')),
  sort_order INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS service_areas (
  id TEXT PRIMARY KEY,
  brief_version_id TEXT NOT NULL REFERENCES project_brief_versions(id),
  city TEXT NOT NULL,
  region TEXT,
  country_iso TEXT NOT NULL,
  radius_km REAL,
  is_primary INTEGER NOT NULL DEFAULT 0,
  unique_proof_json TEXT NOT NULL DEFAULT '[]',
  sort_order INTEGER NOT NULL
);

-- ===== Phase 2: runs/stages/ledger =====
CREATE TABLE IF NOT EXISTS research_estimates (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  brief_version_id TEXT NOT NULL,
  plan_json TEXT NOT NULL,
  min_cost_usd_micro INTEGER NOT NULL,
  max_cost_usd_micro INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS research_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  brief_version_id TEXT NOT NULL,
  estimate_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','estimating','queued','running','partial','succeeded','failed','cancel_requested','cancelled')),
  dataforseo_budget_usd_micro INTEGER NOT NULL DEFAULT 0,
  openrouter_budget_usd_micro INTEGER NOT NULL DEFAULT 0,
  dataforseo_reserved_usd_micro INTEGER NOT NULL DEFAULT 0,
  openrouter_reserved_usd_micro INTEGER NOT NULL DEFAULT 0,
  dataforseo_actual_usd_micro INTEGER NOT NULL DEFAULT 0,
  openrouter_actual_usd_micro INTEGER NOT NULL DEFAULT 0,
  current_stage TEXT,
  partial_reasons_json TEXT NOT NULL DEFAULT '[]',
  started_at TEXT,
  finished_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_runs_project ON research_runs(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_runs_status ON research_runs(status, current_stage);

CREATE TABLE IF NOT EXISTS research_stage_runs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES research_runs(id),
  stage_name TEXT NOT NULL,
  stage_input_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','queued','running','succeeded','skipped','partial','retry_wait','failed','cancelled')),
  required INTEGER NOT NULL DEFAULT 1,
  lease_owner TEXT,
  lease_expires_at TEXT,
  lease_epoch INTEGER NOT NULL DEFAULT 0,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  input_hash TEXT,
  output_hash TEXT,
  output_artifact_id TEXT,
  output_json TEXT,
  prompt_version TEXT,
  schema_version TEXT,
  ruleset_version TEXT,
  model_policy_version TEXT,
  started_at TEXT,
  finished_at TEXT,
  next_retry_at TEXT,
  safe_error_code TEXT,
  safe_error_message TEXT,
  cost_usd_micro INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER,
  UNIQUE(run_id, stage_name, stage_input_hash)
);
CREATE INDEX IF NOT EXISTS idx_stage_runs_run ON research_stage_runs(run_id, stage_name);
CREATE INDEX IF NOT EXISTS idx_stage_runs_retry ON research_stage_runs(status, next_retry_at);

CREATE TABLE IF NOT EXISTS provider_budget_reservations (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES research_runs(id),
  provider TEXT NOT NULL CHECK (provider IN ('dataforseo','openrouter')),
  operation_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('reserved','reconciled','released')),
  estimated_cost_usd_micro INTEGER NOT NULL,
  actual_cost_usd_micro INTEGER,
  created_at TEXT NOT NULL,
  reconciled_at TEXT,
  UNIQUE(run_id, provider, operation_key)
);

CREATE TABLE IF NOT EXISTS idempotency_records (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  route_key TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('in_progress','completed','failed')),
  resource_type TEXT,
  resource_id TEXT,
  response_status INTEGER,
  response_json TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  UNIQUE(organization_id, route_key, idempotency_key)
);

CREATE TABLE IF NOT EXISTS provider_usage (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  provider TEXT NOT NULL,
  operation TEXT NOT NULL,
  endpoint_or_model TEXT NOT NULL,
  provider_request_id TEXT,
  provider_task_ids_json TEXT NOT NULL DEFAULT '[]',
  provider_generation_id TEXT,
  cache_status TEXT NOT NULL CHECK (cache_status IN ('hit','miss','bypass')),
  request_count INTEGER NOT NULL,
  returned_item_count INTEGER,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  reasoning_tokens INTEGER,
  cached_tokens INTEGER,
  finish_reason TEXT,
  cost_usd_micro INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_provider_usage_run ON provider_usage(run_id);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  run_id TEXT,
  kind TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  encrypted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  expires_at TEXT
);

-- ===== Phase 2: evidence (DDL only this phase) =====
CREATE TABLE IF NOT EXISTS evidence_refs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  kind TEXT NOT NULL,
  operation TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  provider_task_id TEXT,
  source_updated_at TEXT,
  fetched_at TEXT NOT NULL,
  cost_usd_micro INTEGER NOT NULL DEFAULT 0,
  artifact_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_evidence_kind ON evidence_refs(run_id, kind);

CREATE TABLE IF NOT EXISTS keywords (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  display_keyword TEXT NOT NULL,
  normalized_keyword TEXT NOT NULL,
  core_keyword TEXT,
  language_code TEXT,
  is_language_mismatch INTEGER NOT NULL DEFAULT 0,
  relevance_score REAL,
  opportunity_score REAL,
  search_volume INTEGER,
  cpc_usd_micro INTEGER,
  paid_competition REAL,
  keyword_difficulty INTEGER,
  main_intent TEXT,
  intent_probabilities_json TEXT,
  monthly_searches_json TEXT,
  serp_features_json TEXT,
  avg_referring_domains REAL,
  metrics_missing INTEGER NOT NULL DEFAULT 0,
  excluded_reason TEXT,
  UNIQUE(run_id, normalized_keyword)
);
CREATE TABLE IF NOT EXISTS keyword_services (keyword_id TEXT NOT NULL, service_id TEXT NOT NULL, PRIMARY KEY (keyword_id, service_id));
CREATE TABLE IF NOT EXISTS keyword_service_areas (keyword_id TEXT NOT NULL, service_area_id TEXT NOT NULL, PRIMARY KEY (keyword_id, service_area_id));
CREATE TABLE IF NOT EXISTS keyword_evidence_refs (keyword_id TEXT NOT NULL, evidence_ref_id TEXT NOT NULL, PRIMARY KEY (keyword_id, evidence_ref_id));

CREATE TABLE IF NOT EXISTS competitors (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  display_name TEXT,
  source TEXT NOT NULL,
  classification TEXT,
  selected INTEGER NOT NULL DEFAULT 0,
  exclusion_reason TEXT,
  relevance_score REAL,
  visibility_score REAL,
  estimated_traffic REAL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_selected_competitor_domain ON competitors(run_id, domain) WHERE selected = 1;
CREATE TABLE IF NOT EXISTS competitor_evidence_refs (competitor_id TEXT NOT NULL, evidence_ref_id TEXT NOT NULL, PRIMARY KEY (competitor_id, evidence_ref_id));

CREATE TABLE IF NOT EXISTS serp_snapshots (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  keyword_id TEXT NOT NULL,
  service_area_id TEXT,
  location_code INTEGER NOT NULL,
  language_code TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  organic_json TEXT,
  related_searches_json TEXT,
  local_pack_present INTEGER,
  featured_snippet_present INTEGER,
  ai_overview_status TEXT
);
CREATE TABLE IF NOT EXISTS faq_evidence (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  serp_snapshot_id TEXT,
  question TEXT NOT NULL,
  answer_text TEXT,
  source_title TEXT,
  source_url TEXT,
  parent_question_id TEXT,
  paa_depth INTEGER NOT NULL DEFAULT 1
);

-- ===== Phase 2: clusters/blueprints =====
CREATE TABLE IF NOT EXISTS keyword_clusters (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  label TEXT NOT NULL,
  service_id TEXT,
  service_area_id TEXT,
  intent TEXT,
  primary_keyword_id TEXT,
  semantic_cohesion REAL,
  serp_overlap_cohesion REAL,
  confidence_score REAL,
  confidence_label TEXT,
  page_candidate TEXT,
  decision_reason TEXT,
  warnings_json TEXT NOT NULL DEFAULT '[]',
  adjudication_json TEXT,
  ruleset_version TEXT,
  score_breakdown_json TEXT
);
CREATE TABLE IF NOT EXISTS cluster_keywords (cluster_id TEXT NOT NULL, keyword_id TEXT NOT NULL, membership_score REAL, is_primary INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (cluster_id, keyword_id));

CREATE TABLE IF NOT EXISTS blueprint_versions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  run_id TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  status TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  ruleset_version TEXT NOT NULL,
  completeness TEXT NOT NULL,
  partial_reasons_json TEXT NOT NULL DEFAULT '[]',
  summary_json TEXT NOT NULL DEFAULT '{}',
  latest_revision_id TEXT,
  published_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(run_id),
  UNIQUE(project_id, version_number)
);

CREATE TABLE IF NOT EXISTS blueprint_revisions (
  id TEXT PRIMARY KEY,
  blueprint_version_id TEXT NOT NULL REFERENCES blueprint_versions(id),
  parent_revision_id TEXT,
  revision_number INTEGER NOT NULL,
  revision_hash TEXT NOT NULL,
  change_summary TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(blueprint_version_id, revision_number),
  UNIQUE(blueprint_version_id, revision_hash)
);

CREATE TABLE IF NOT EXISTS blueprint_pages (
  row_id TEXT PRIMARY KEY,
  blueprint_revision_id TEXT NOT NULL REFERENCES blueprint_revisions(id),
  logical_page_id TEXT NOT NULL,
  parent_logical_page_id TEXT,
  page_type TEXT NOT NULL,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  primary_keyword_normalized TEXT,
  recommendation TEXT NOT NULL CHECK (recommendation IN ('create','update','keep','consolidate')),
  approval TEXT NOT NULL CHECK (approval IN ('proposed','approved','rejected','locked')),
  consolidate_target_logical_page_id TEXT,
  priority TEXT,
  confidence_label TEXT,
  page_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE(blueprint_revision_id, logical_page_id),
  CHECK (parent_logical_page_id IS NULL OR parent_logical_page_id <> logical_page_id),
  CHECK (recommendation <> 'consolidate' OR consolidate_target_logical_page_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_bp_pages_parent ON blueprint_pages(blueprint_revision_id, parent_logical_page_id);

CREATE TABLE IF NOT EXISTS blueprint_mutation_events (
  id TEXT PRIMARY KEY,
  blueprint_version_id TEXT NOT NULL,
  base_revision_id TEXT,
  result_revision_id TEXT NOT NULL,
  page_id TEXT,
  actor_id TEXT NOT NULL,
  mutation_type TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  reason TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS export_jobs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  blueprint_version_id TEXT NOT NULL,
  blueprint_revision_id TEXT NOT NULL,
  revision_hash TEXT NOT NULL,
  request_json TEXT NOT NULL,
  status TEXT NOT NULL,
  artifact_id TEXT,
  safe_error TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  finished_at TEXT,
  expires_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_export_status ON export_jobs(status);

UPDATE blueprint_meta SET value = '2', updated_at = datetime('now') WHERE key = 'schema_version' AND value < '2';

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

UPDATE blueprint_meta SET value = '3', updated_at = datetime('now') WHERE key = 'schema_version' AND CAST(value AS INTEGER) < 3;

-- ===== Phase 4: clustering + page-planning schema =====
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

UPDATE blueprint_meta SET value = '4', updated_at = datetime('now') WHERE key = 'schema_version' AND CAST(value AS INTEGER) < 4;
