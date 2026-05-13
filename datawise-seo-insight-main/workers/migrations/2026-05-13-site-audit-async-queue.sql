-- Site audit async queue metadata and diagnostics.
ALTER TABLE site_audits ADD COLUMN next_poll_at TEXT;
ALTER TABLE site_audits ADD COLUMN retry_count INTEGER DEFAULT 0;
ALTER TABLE site_audits ADD COLUMN processing_locked_until TEXT;
ALTER TABLE site_audits ADD COLUMN crawl_diagnostics TEXT;

CREATE INDEX IF NOT EXISTS idx_site_audits_queue
  ON site_audits(status, next_poll_at, processing_locked_until);
