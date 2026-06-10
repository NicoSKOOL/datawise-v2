-- Store the full AI answer per visibility check so users can read exactly
-- what the engine said. Additive; old rows stay NULL.
ALTER TABLE ai_visibility_checks ADD COLUMN answer_text TEXT;
