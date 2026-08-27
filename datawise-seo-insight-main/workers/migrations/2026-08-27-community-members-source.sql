-- Community roster durability (fix: paying Skool members revoked by CSV uploads).
-- Run BEFORE deploying the worker that introduces upsert-based uploads:
--   CLOUDFLARE_ACCOUNT_ID=510d0ac03a3a8f5ebeac39be4926ed77 \
--     npx wrangler d1 execute datawise-db --remote --file=migrations/2026-08-27-community-members-source.sql

-- 1) Row provenance: 'csv' rows are managed (and revocable) by the Skool CSV
--    upload; 'webhook' and 'manual' rows survive uploads.
ALTER TABLE community_members ADD COLUMN source TEXT NOT NULL DEFAULT 'csv';

-- 2) Canonical email (gmail dots/+tags collapsed) for alias-tolerant matching.
ALTER TABLE community_members ADD COLUMN normalized_email TEXT;

-- 3) The old wipe-and-reload used INSERT OR REPLACE without a guaranteed
--    unique index, so duplicates may exist. Dedupe, then ensure the unique
--    index the new ON CONFLICT(email) upserts rely on.
DELETE FROM community_members WHERE id NOT IN (
  SELECT MIN(id) FROM community_members GROUP BY lower(email)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_community_members_email ON community_members(email);
CREATE INDEX IF NOT EXISTS idx_community_members_normalized ON community_members(normalized_email);

-- 4) Best-effort backfill: lowercase + trim. Gmail dot/plus collapsing cannot
--    be expressed in SQLite; the worker recomputes normalized_email on every
--    upload/webhook/manual write and lookups fall back to lower(email), so
--    rows converge to fully-normalized forms on the first CSV upload after
--    deploy.
UPDATE community_members SET normalized_email = lower(trim(email)) WHERE normalized_email IS NULL;

-- 5) The two members manually re-added on 2026-08-27 after being falsely
--    revoked: make their rows durable so the next CSV upload keeps them.
UPDATE community_members SET source = 'manual'
WHERE lower(email) IN ('jinshin79@gmail.com', 'hasnain@ewebmarketing.com.au');
