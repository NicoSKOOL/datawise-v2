-- Content Writer Builder: per-property workspaces, KB docs, and generated posts.
-- Apply with: wrangler d1 execute datawise-db --file=migrations/2026-04-27-content-writer.sql

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
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cwp_workspace ON content_writer_posts(workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_cwp_user ON content_writer_posts(user_id);
