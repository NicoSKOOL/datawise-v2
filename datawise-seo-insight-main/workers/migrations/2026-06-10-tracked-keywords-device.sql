-- Rank Tracking: per-keyword device (desktop/mobile) for SERP checks.
-- Additive only: existing rows get 'desktop', which matches the previously
-- hardcoded behavior. Safe to apply before the worker code that reads it.

ALTER TABLE tracked_keywords ADD COLUMN device TEXT DEFAULT 'desktop';
