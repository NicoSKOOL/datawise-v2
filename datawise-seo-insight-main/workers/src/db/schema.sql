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
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

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
  UNIQUE(user_id, site_url)
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
  country TEXT
);

CREATE INDEX IF NOT EXISTS idx_gsc_search_data_property_date ON gsc_search_data(property_id, date);
CREATE INDEX IF NOT EXISTS idx_gsc_search_data_query ON gsc_search_data(property_id, query);

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
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_feedback_reports_user ON feedback_reports(user_id);
CREATE INDEX IF NOT EXISTS idx_feedback_reports_status ON feedback_reports(status);
