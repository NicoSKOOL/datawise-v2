-- Safe migration: CREATE TABLE IF NOT EXISTS + safe ALTER TABLE
-- This can be re-run without errors

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

CREATE TABLE IF NOT EXISTS seo_projects (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  domain TEXT,
  project_type TEXT DEFAULT 'organic',
  place_id TEXT,
  cid TEXT,
  business_name TEXT,
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

-- Add credits exhausted email tracking (safe to re-run: D1 ignores duplicate columns)
ALTER TABLE users ADD COLUMN credits_exhausted_email_sent INTEGER DEFAULT 0;

CREATE TABLE IF NOT EXISTS local_rank_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword_id TEXT NOT NULL REFERENCES tracked_keywords(id) ON DELETE CASCADE,
  pack_position INTEGER,
  rating REAL,
  reviews_count INTEGER,
  checked_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_local_rank_history_keyword ON local_rank_history(keyword_id, checked_at);
