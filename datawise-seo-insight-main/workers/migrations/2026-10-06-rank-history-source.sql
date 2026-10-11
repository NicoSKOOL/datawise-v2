-- rank_history.source: where a position came from.
--   NULL       = live SERP check (every row written before this column existed)
--   'gsc_seed' = placeholder copied from Site Rankings (GSC) when a keyword is
--                added, so the table is not empty until the first live check.
-- Seed rows must not count as a check: the scheduler treated them as "checked
-- in the last 6 days" and skipped new projects for a week, showing GSC
-- averages as if they were SERP positions (Elliot, harbourholidays.co.uk,
-- 2026-10-01).
ALTER TABLE rank_history ADD COLUMN source TEXT;
