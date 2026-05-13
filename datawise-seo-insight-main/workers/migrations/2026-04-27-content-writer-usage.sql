-- Track per-step LLM token usage on each post so we can show total
-- "cost per blog" across Research + Outline + Draft + Review.
ALTER TABLE content_writer_posts ADD COLUMN usage_json TEXT;
