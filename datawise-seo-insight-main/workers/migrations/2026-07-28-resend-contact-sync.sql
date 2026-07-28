-- Ledger for the Resend contact sync. One row per synced address.
--
-- Keyed by the canonical email (src/lib/email-normalize.ts), same as
-- email_suppressions, so the two join directly. We do NOT store the Resend
-- contact id: every Resend contact endpoint accepts an email in place of an id,
-- so the address is a sufficient handle and there is no second identity to
-- keep in step.
--
-- props_hash is a fingerprint of everything we push (names, segment, all dw_*
-- properties). Unchanged contacts match on it and cost zero API calls, which is
-- what keeps the steady-state cron nearly free.
CREATE TABLE IF NOT EXISTS resend_contact_sync (
  email TEXT PRIMARY KEY,
  user_id TEXT,
  segment TEXT,
  props_hash TEXT,
  synced_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_resend_contact_sync_user ON resend_contact_sync(user_id);
