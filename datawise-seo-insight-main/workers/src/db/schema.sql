-- DataWise V2 D1 Schema
-- Fresh start, no migration from Supabase

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  google_id TEXT UNIQUE,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  name TEXT,
  avatar_url TEXT,
  subscription_tier TEXT DEFAULT 'free' CHECK (subscription_tier IN ('free', 'pro', 'community')),
  is_community_member INTEGER DEFAULT 0,
  is_admin INTEGER DEFAULT 0,
  credits_used INTEGER DEFAULT 0,
  credits_exhausted_email_sent INTEGER DEFAULT 0,
  default_location_code INTEGER DEFAULT 2840,
  default_language_code TEXT DEFAULT 'en',
  signup_utm_source TEXT,
  signup_utm_medium TEXT,
  signup_utm_campaign TEXT,
  signup_utm_content TEXT,
  signup_utm_term TEXT,
  signup_referrer TEXT,
  signup_landing_path TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_users_signup_utm_source ON users(signup_utm_source);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS gsc_connections (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT NOT NULL,
  token_expires_at TEXT NOT NULL,
  connected_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS gsc_properties (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  site_url TEXT NOT NULL,
  permission_level TEXT,
  last_synced_at TEXT,
  color TEXT DEFAULT '#6366f1',
  is_enabled INTEGER DEFAULT 1,
  kind TEXT NOT NULL DEFAULT 'gsc',
  site_group_id TEXT,
  UNIQUE(user_id, site_url)
);

CREATE INDEX IF NOT EXISTS idx_properties_group ON gsc_properties(user_id, site_group_id);

CREATE TABLE IF NOT EXISTS bwt_connections (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT NOT NULL,
  token_expires_at TEXT NOT NULL,
  connected_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS gsc_search_data (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id TEXT NOT NULL REFERENCES gsc_properties(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  query TEXT NOT NULL,
  page TEXT,
  clicks INTEGER DEFAULT 0,
  impressions INTEGER DEFAULT 0,
  ctr REAL DEFAULT 0,
  position REAL DEFAULT 0,
  device TEXT,
  country TEXT,
  source TEXT NOT NULL DEFAULT 'gsc'
);

CREATE INDEX IF NOT EXISTS idx_gsc_search_data_property_date ON gsc_search_data(property_id, date);
CREATE INDEX IF NOT EXISTS idx_gsc_search_data_query ON gsc_search_data(property_id, query);
CREATE INDEX IF NOT EXISTS idx_search_data_source ON gsc_search_data(property_id, source, date);

CREATE TABLE IF NOT EXISTS chat_conversations (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  property_id TEXT REFERENCES gsc_properties(id),
  title TEXT DEFAULT 'New Conversation',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id TEXT REFERENCES chat_conversations(id),
  message_id TEXT REFERENCES chat_messages(id),
  title TEXT NOT NULL,
  description TEXT,
  priority TEXT DEFAULT 'medium' CHECK (priority IN ('high', 'medium', 'low')),
  status TEXT DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'done')),
  due_date TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS seo_projects (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  domain TEXT,
  project_type TEXT DEFAULT 'organic',
  place_id TEXT,
  cid TEXT,
  business_name TEXT,
  location_code INTEGER DEFAULT 2840,
  latitude REAL,
  longitude REAL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tracked_keywords (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  project_id TEXT NOT NULL REFERENCES seo_projects(id) ON DELETE CASCADE,
  keyword TEXT NOT NULL,
  location_code INTEGER,
  language_code TEXT,
  device TEXT DEFAULT 'desktop',
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rank_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword_id TEXT NOT NULL REFERENCES tracked_keywords(id) ON DELETE CASCADE,
  position INTEGER,
  rank_group INTEGER,
  estimated_traffic REAL,
  checked_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rank_history_keyword ON rank_history(keyword_id, checked_at);

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  plan TEXT DEFAULT 'free',
  status TEXT DEFAULT 'active',
  current_period_end TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Community member management (Skool CSV imports)
CREATE TABLE IF NOT EXISTS community_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  tier TEXT,
  ltv REAL,
  joined_date TEXT,
  uploaded_at TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_community_members_email ON community_members(email);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL,
  expires_at TEXT NOT NULL,
  used INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS local_rank_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword_id TEXT NOT NULL REFERENCES tracked_keywords(id) ON DELETE CASCADE,
  pack_position INTEGER,
  rating REAL,
  reviews_count INTEGER,
  checked_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_local_rank_history_keyword ON local_rank_history(keyword_id, checked_at);

-- GeoGrid scan results
CREATE TABLE IF NOT EXISTS geogrid_scans (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  project_id TEXT NOT NULL REFERENCES seo_projects(id) ON DELETE CASCADE,
  keyword TEXT NOT NULL,
  grid_size INTEGER DEFAULT 7,
  radius_km REAL DEFAULT 3.0,
  center_lat REAL NOT NULL,
  center_lng REAL NOT NULL,
  results TEXT NOT NULL,
  avg_position REAL,
  top3_count INTEGER DEFAULT 0,
  found_count INTEGER DEFAULT 0,
  scanned_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_geogrid_scans_project ON geogrid_scans(project_id, scanned_at);

-- Feedback / bug reports
CREATE TABLE IF NOT EXISTS feedback_reports (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('bug', 'feature')),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  page_url TEXT,
  browser_info TEXT,
  screenshot_info TEXT,
  severity TEXT DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  status TEXT DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'resolved', 'closed')),
  admin_notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  roadmap_status TEXT,
  roadmap_public_title TEXT,
  roadmap_public_description TEXT,
  shipped_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_feedback_reports_user ON feedback_reports(user_id);
CREATE INDEX IF NOT EXISTS idx_feedback_reports_status ON feedback_reports(status);
CREATE INDEX IF NOT EXISTS idx_feedback_roadmap_status
  ON feedback_reports(roadmap_status)
  WHERE roadmap_status IS NOT NULL;

-- Email drip sequences (nurture campaigns)
CREATE TABLE IF NOT EXISTS email_sequences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sequence_type TEXT NOT NULL DEFAULT 'credits_exhausted',
  current_step INTEGER DEFAULT 0,
  next_send_at TEXT NOT NULL,
  completed INTEGER DEFAULT 0,
  cancelled INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_email_sequences_pending
  ON email_sequences(next_send_at)
  WHERE completed = 0 AND cancelled = 0;
CREATE INDEX IF NOT EXISTS idx_email_sequences_user ON email_sequences(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_sequences_user_active
  ON email_sequences(user_id, sequence_type)
  WHERE completed = 0 AND cancelled = 0;

-- Promo codes for YouTube lead tracking
CREATE TABLE IF NOT EXISTS promo_codes (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  code TEXT UNIQUE NOT NULL,
  label TEXT NOT NULL,
  duration_hours INTEGER DEFAULT 48,
  max_redemptions INTEGER,
  expires_at TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS promo_redemptions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  promo_code_id TEXT NOT NULL REFERENCES promo_codes(id),
  activated_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  UNIQUE(user_id, promo_code_id)
);
CREATE INDEX IF NOT EXISTS idx_promo_redemptions_user ON promo_redemptions(user_id);
CREATE INDEX IF NOT EXISTS idx_promo_redemptions_code ON promo_redemptions(promo_code_id);

-- Tier change audit log for conversion tracking
CREATE TABLE IF NOT EXISTS tier_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_tier TEXT NOT NULL,
  to_tier TEXT NOT NULL,
  source TEXT NOT NULL,
  changed_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tier_changes_user ON tier_changes(user_id);
CREATE INDEX IF NOT EXISTS idx_tier_changes_date ON tier_changes(changed_at);

-- Site Audit + 7-Day Action Plan
CREATE TABLE IF NOT EXISTS site_audits (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  domain TEXT NOT NULL,
  start_url TEXT NOT NULL,
  dataforseo_task_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','analyzing','completed','failed')),
  pages_crawled INTEGER DEFAULT 0,
  score INTEGER,
  perf_score INTEGER,
  seo_score INTEGER,
  a11y_score INTEGER,
  best_practices_score INTEGER,
  lighthouse_data TEXT,
  ai_analysis TEXT,
  seo_analysis TEXT,
  error_message TEXT,
  last_polled_at TEXT,
  next_poll_at TEXT,
  retry_count INTEGER DEFAULT 0,
  processing_locked_until TEXT,
  crawl_diagnostics TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_site_audits_user ON site_audits(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_site_audits_queue ON site_audits(status, next_poll_at, processing_locked_until);

CREATE TABLE IF NOT EXISTS audit_findings (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  audit_id TEXT NOT NULL REFERENCES site_audits(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('critical','high','medium','low')),
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  page_url TEXT,
  evidence TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_findings_audit ON audit_findings(audit_id);

CREATE TABLE IF NOT EXISTS audit_action_items (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  audit_id TEXT REFERENCES site_audits(id) ON DELETE SET NULL,
  property_id TEXT,
  finding_id TEXT REFERENCES audit_findings(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'audit'
    CHECK (source IN ('audit','manual')),
  title TEXT NOT NULL,
  how_to_fix TEXT NOT NULL DEFAULT '',
  category TEXT,
  url TEXT,
  priority TEXT NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('high','medium','low')),
  status TEXT NOT NULL DEFAULT 'todo'
    CHECK (status IN ('todo','in_progress','done')),
  position INTEGER DEFAULT 0,
  due_date TEXT,
  subtasks TEXT,
  attachments TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_action_items_audit_status ON audit_action_items(audit_id, status, position);
CREATE INDEX IF NOT EXISTS idx_action_items_property_status ON audit_action_items(property_id, status, position);

-- Google Business Profile integration
CREATE TABLE IF NOT EXISTS gbp_connections (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT NOT NULL,
  token_expires_at TEXT NOT NULL,
  account_name TEXT,
  connected_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS gbp_locations (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_name TEXT NOT NULL,
  location_name TEXT NOT NULL,
  display_name TEXT,
  address TEXT,
  place_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, location_name)
);

-- Content Planner: topic clusters (hub-and-spoke content structure)
-- Scoped per GSC property so each site has its own plan.
CREATE TABLE IF NOT EXISTS planner_clusters (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  property_id TEXT REFERENCES gsc_properties(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  color TEXT DEFAULT '#6366f1',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_planner_clusters_user ON planner_clusters(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_planner_clusters_user_property
  ON planner_clusters(user_id, property_id, created_at DESC);

-- Content Planner: user-scoped keyword hub with intent tags and lifecycle kanban.
-- Scoped per GSC property so each site has its own plan.
CREATE TABLE IF NOT EXISTS planner_keywords (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  property_id TEXT REFERENCES gsc_properties(id) ON DELETE CASCADE,
  keyword TEXT NOT NULL,
  intent TEXT NOT NULL DEFAULT 'informational'
    CHECK (intent IN ('transactional','informational','commercial','navigational','fan_out')),
  status TEXT NOT NULL DEFAULT 'backlog'
    CHECK (status IN ('backlog','assigned','draft','published','indexed','ranking')),
  assigned_url TEXT,
  notes TEXT,
  search_volume INTEGER,
  keyword_difficulty INTEGER,
  cpc REAL,
  competition REAL,
  source TEXT,
  source_context TEXT,
  -- Content brief: JSON blob with title, additional_keywords, outline, meta_description, target_audience, cta
  content_brief TEXT,
  -- Topic cluster assignment (nullable = unclustered)
  cluster_id TEXT REFERENCES planner_clusters(id) ON DELETE SET NULL,
  is_pillar INTEGER DEFAULT 0,
  position INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
  -- NOTE: uniqueness is enforced below via a partial index on (user_id, property_id, keyword)
  -- instead of a table-level UNIQUE, so legacy environments migrated via ALTER TABLE can
  -- also adopt the new constraint without rebuilding the table.
);
CREATE INDEX IF NOT EXISTS idx_planner_keywords_user_status
  ON planner_keywords(user_id, status, position);
CREATE INDEX IF NOT EXISTS idx_planner_keywords_user_property_status
  ON planner_keywords(user_id, property_id, status, position);
CREATE INDEX IF NOT EXISTS idx_planner_keywords_user_intent
  ON planner_keywords(user_id, intent);
CREATE INDEX IF NOT EXISTS idx_planner_keywords_user_property_intent
  ON planner_keywords(user_id, property_id, intent);
CREATE INDEX IF NOT EXISTS idx_planner_keywords_cluster
  ON planner_keywords(cluster_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_planner_keywords_unique_user_property_keyword
  ON planner_keywords(user_id, property_id, keyword);

-- Anonymous pageview log for admin traffic-source analytics.
-- No IP is stored. country comes from request.cf.country. Bots are filtered
-- server-side before insert. Pruned to ~90 days by the scheduled cron.
CREATE TABLE IF NOT EXISTS pageviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  path TEXT NOT NULL,
  referrer TEXT,
  referrer_host TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  utm_term TEXT,
  country TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pageviews_created_at ON pageviews(created_at);
CREATE INDEX IF NOT EXISTS idx_pageviews_session ON pageviews(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_pageviews_utm_source ON pageviews(utm_source);
CREATE INDEX IF NOT EXISTS idx_pageviews_referrer_host ON pageviews(referrer_host);

CREATE TABLE IF NOT EXISTS gbp_scheduled_posts (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  location_name TEXT NOT NULL,
  content TEXT NOT NULL,
  call_to_action_type TEXT,
  call_to_action_url TEXT,
  media_url TEXT,
  scheduled_at TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'published', 'failed')),
  published_post_name TEXT,
  error_message TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Local citations checklist: user-tracked completion state for citation submissions.
CREATE TABLE IF NOT EXISTS citation_checklist (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  citation_key TEXT NOT NULL,
  completed_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, citation_key)
);

-- Custom citations: user-added directories per local SEO project.
CREATE TABLE IF NOT EXISTS custom_citations (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES seo_projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  category TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_custom_citations_user_project
  ON custom_citations(user_id, project_id);

-- Content Writer Builder: per-property workspaces, each with a 5-doc knowledge base
-- and a set of generated blog posts. KB docs and posts share the workspace.
CREATE TABLE IF NOT EXISTS content_writer_workspaces (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  property_id TEXT REFERENCES gsc_properties(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  website_url TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cww_user ON content_writer_workspaces(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_cww_user_property ON content_writer_workspaces(user_id, property_id);

CREATE TABLE IF NOT EXISTS content_writer_kb_docs (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  workspace_id TEXT NOT NULL REFERENCES content_writer_workspaces(id) ON DELETE CASCADE,
  doc_type TEXT NOT NULL CHECK (doc_type IN
    ('sitemap','tone_of_voice','experience_notes','service_details','brand_guidelines')),
  status TEXT NOT NULL DEFAULT 'empty'
    CHECK (status IN ('empty','in_progress','ready')),
  content TEXT,
  conversation_id TEXT REFERENCES chat_conversations(id) ON DELETE SET NULL,
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(workspace_id, doc_type)
);
CREATE INDEX IF NOT EXISTS idx_cwk_workspace ON content_writer_kb_docs(workspace_id);

CREATE TABLE IF NOT EXISTS content_writer_posts (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  workspace_id TEXT NOT NULL REFERENCES content_writer_workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT,
  topic TEXT,
  target_keyword TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','researched','outlined','written')),
  brief_json TEXT,
  sources_json TEXT,
  outline_json TEXT,
  body_html TEXT,
  body_md TEXT,
  -- Per-step token usage. JSON object keyed by step name (research/outline/draft/review)
  -- with shape { input, output, model, provider, at }. Used to compute total post cost.
  usage_json TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cwp_workspace ON content_writer_posts(workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_cwp_user ON content_writer_posts(user_id);

-- Admin-managed Content Writer prompts. Drafts are editable without affecting
-- generation; only published_text is used by the writer pipeline.
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
