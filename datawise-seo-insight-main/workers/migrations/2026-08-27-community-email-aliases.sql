-- Links a DataWise login email to the Skool roster email of the same person.
--
-- Members routinely join Skool as one address and sign up for DataWise as
-- another. The roster grant then lands on an account they never log into while
-- their real account hits the free-credit wall. An alias records that the two
-- addresses are ONE person, which a second community_members row could not: a
-- roster row would inflate the member count and imply a second subscription.
--
-- Run before deploying the worker that reads it:
--   CLOUDFLARE_ACCOUNT_ID=510d0ac03a3a8f5ebeac39be4926ed77 \
--     npx wrangler d1 execute datawise-db --remote --file=migrations/2026-08-27-community-email-aliases.sql

CREATE TABLE IF NOT EXISTS community_email_aliases (
  -- The address the person actually logs in with. One alias per login email.
  alias_email TEXT PRIMARY KEY,
  -- The community_members.email they are really covered by.
  member_email TEXT NOT NULL,
  -- Canonical forms (gmail dots/+tags collapsed), matching community_members.
  alias_normalized TEXT,
  member_normalized TEXT,
  linked_by TEXT,
  note TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_alias_member ON community_email_aliases(member_email);
CREATE INDEX IF NOT EXISTS idx_alias_normalized ON community_email_aliases(alias_normalized);
