-- Dormant-account GSC storage purge marker.
-- purged_at is stamped when purgeDormantGSCData deletes a property's
-- gsc_search_data rows (owner had no session in 60 days); a successful sync
-- clears it. resyncPurgedProperties uses it to repopulate returning users.
--
-- MUST be applied to production D1 BEFORE the worker referencing purged_at is
-- deployed: handleGSCSync's success UPDATE names the column, so deploying the
-- worker first would fail every sync. Additive and instant (9,894 rows).

ALTER TABLE gsc_properties ADD COLUMN purged_at TEXT;
