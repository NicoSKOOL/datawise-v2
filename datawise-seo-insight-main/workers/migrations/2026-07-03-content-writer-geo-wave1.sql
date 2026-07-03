-- workers/migrations/2026-07-03-content-writer-geo-wave1.sql
-- Content Writer GEO wave 1: persist the review report and SEO meta.
ALTER TABLE content_writer_posts ADD COLUMN review_json TEXT;
ALTER TABLE content_writer_posts ADD COLUMN seo_title TEXT;
ALTER TABLE content_writer_posts ADD COLUMN seo_meta_description TEXT;
