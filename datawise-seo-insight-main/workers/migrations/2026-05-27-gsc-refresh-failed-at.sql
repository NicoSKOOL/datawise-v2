-- Track when a GSC refresh-token refresh last failed for a user, so the SPA
-- can surface a "Google connection expired, please reconnect" banner instead
-- of silently 403-ing every sync. Additive, nullable column — no data loss,
-- safe to apply before the worker code that references it.

ALTER TABLE gsc_connections ADD COLUMN refresh_failed_at TEXT;
