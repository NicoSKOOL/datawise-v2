-- Public roadmap surface for feedback_reports.
-- Admin promotes a report by setting roadmap_status; the /api/roadmap endpoint
-- exposes only the public title/description (PII-stripped) grouped by status.

ALTER TABLE feedback_reports ADD COLUMN roadmap_status TEXT;
ALTER TABLE feedback_reports ADD COLUMN roadmap_public_title TEXT;
ALTER TABLE feedback_reports ADD COLUMN roadmap_public_description TEXT;
ALTER TABLE feedback_reports ADD COLUMN shipped_at TEXT;

CREATE INDEX IF NOT EXISTS idx_feedback_roadmap_status
  ON feedback_reports(roadmap_status)
  WHERE roadmap_status IS NOT NULL;
