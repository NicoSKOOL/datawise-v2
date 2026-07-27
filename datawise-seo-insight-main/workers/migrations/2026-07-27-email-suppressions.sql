-- Global email opt-out store. One row per suppressed address.
--
-- Keyed by the CANONICAL email (see src/lib/email-normalize.ts), matching how
-- banned_emails already works: gmail dots and "+tags" collapse to one identity,
-- so someone who unsubscribes as foo+dw@gmail.com cannot be re-mailed at
-- f.oo@gmail.com. Suppressing more than asked is the safe direction.
--
-- scope 'marketing' blocks sequences + broadcasts and allows password resets
-- (the user explicitly asked for that one). scope 'all' blocks everything and
-- is reserved for permanent bounces, where the address does not exist.
CREATE TABLE IF NOT EXISTS email_suppressions (
  email TEXT PRIMARY KEY,
  scope TEXT NOT NULL DEFAULT 'marketing' CHECK (scope IN ('marketing', 'all')),
  reason TEXT NOT NULL CHECK (reason IN ('unsubscribe', 'complaint', 'bounce', 'manual')),
  source TEXT,
  user_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_email_suppressions_user ON email_suppressions(user_id);
