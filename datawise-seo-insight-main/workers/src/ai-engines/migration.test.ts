import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestDb } from '../test-support/d1';

const here = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(join(here, '..', '..', 'migrations', '2026-09-07-ai-engines-v2.sql'), 'utf8');

describe('ai-engines-v2 migration', () => {
  it('schema.sql already contains the v2 columns so the app schema and migration agree', () => {
    const { raw } = createTestDb();
    const cols = raw.prepare('PRAGMA table_info(ai_visibility_checks)').all().map((c: any) => c.name);
    expect(cols).toEqual(expect.arrayContaining(['model', 'location_code', 'language_code', 'retrieved_url', 'answer_text']));
    const citeCols = raw.prepare('PRAGMA table_info(ai_check_citations)').all().map((c: any) => c.name);
    expect(citeCols).toContain('kind');
    expect(raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ai_check_brands'").get()).toBeTruthy();
  });

  it('migration applies on top of the pre-v2 tables and stores retrieved checks, kinds and brands', () => {
    const { raw } = createTestDb();
    // Recreate the pre-v2 shape to prove the ALTERs apply cleanly.
    raw.exec('DROP TABLE ai_check_brands; DROP TABLE ai_check_citations; DROP TABLE ai_visibility_checks; DROP TABLE ai_tracked_queries;');
    raw.exec(readFileSync(join(here, '..', '..', 'migrations', '2026-06-09-ai-visibility-tracking.sql'), 'utf8').replace(/ALTER TABLE seo_projects[^;]*;/g, ''));
    raw.exec(readFileSync(join(here, '..', '..', 'migrations', '2026-06-10-ai-checks-answer-text.sql'), 'utf8'));
    raw.exec(migration);

    raw.prepare("INSERT INTO users (id, email) VALUES ('u1', 'u1@example.com')").run();
    raw.prepare("INSERT INTO seo_projects (id, user_id, name, domain) VALUES ('p1', 'u1', 'P', 'datawiseseo.com')").run();
    raw.prepare("INSERT INTO ai_tracked_queries (id, project_id, query_text) VALUES ('q1', 'p1', 'best seo tool')").run();
    const check = raw.prepare(`INSERT INTO ai_visibility_checks (query_id, engine, status, retrieved_url, model, location_code, language_code, run_type)
      VALUES ('q1', 'gemini', 'retrieved', 'https://datawiseseo.com/x', '3.5 Flash-Lite', 2840, 'en', 'manual')`).run();
    const checkId = Number(check.lastInsertRowid);
    raw.prepare("INSERT INTO ai_check_citations (check_id, domain, url, position, kind) VALUES (?, 'datawiseseo.com', 'https://datawiseseo.com/x', 1, 'retrieved')").run(checkId);
    raw.prepare("INSERT INTO ai_check_citations (check_id, domain, url, position) VALUES (?, 'reddit.com', 'https://reddit.com/r', 1)").run(checkId);
    raw.prepare("INSERT INTO ai_check_brands (check_id, name, category, is_you) VALUES (?, 'DataWise', 'company', 1)").run(checkId);

    const row = raw.prepare('SELECT status, retrieved_url, model FROM ai_visibility_checks WHERE id = ?').get(checkId) as any;
    expect(row).toEqual({ status: 'retrieved', retrieved_url: 'https://datawiseseo.com/x', model: '3.5 Flash-Lite' });
    const kinds = raw.prepare('SELECT kind FROM ai_check_citations WHERE check_id = ? ORDER BY id').all(checkId).map((r: any) => r.kind);
    expect(kinds).toEqual(['retrieved', 'cited']);
    expect(raw.prepare('SELECT COUNT(*) as n FROM ai_check_brands WHERE check_id = ?').get(checkId)).toEqual({ n: 1 });
  });
});
