import { describe, it, expect } from 'vitest';
import { createTestDb } from '../test-support/d1';
import { handleAddKeywords, handleListKeywords, selectDueRankProjects } from './rank-tracking';

// Regression for 2026-10-01 (harbourholidays.co.uk): keywords added from Site
// Rankings were seeded with the GSC position, and that seed row counted as a
// "check" for the scheduler's 6-day staleness window. The project skipped its
// first live SERP check for a week, so Tracked Keywords showed the GSC blend
// (14) as if it were the live Google position (3).

function makeEnv() {
  const { d1, raw } = createTestDb();
  raw.prepare("INSERT INTO users (id, email) VALUES ('u1', 'u1@example.com')").run();
  raw.prepare("INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ('u1', 'h1', datetime('now', '+5 days'))").run();
  raw.prepare("INSERT INTO seo_projects (id, user_id, name, domain, location_code, created_at) VALUES ('old', 'u1', 'Old', 'old.example', 2826, '2026-01-01')").run();
  raw.prepare("INSERT INTO seo_projects (id, user_id, name, domain, location_code, created_at) VALUES ('new', 'u1', 'New', 'harbourholidays.co.uk', 2826, '2026-10-01')").run();
  // "old" was live-checked 7 days ago, so it is due too, but it has history
  raw.prepare("INSERT INTO tracked_keywords (id, project_id, keyword) VALUES ('k-old', 'old', 'x')").run();
  raw.prepare("INSERT INTO rank_history (keyword_id, position, rank_group, checked_at) VALUES ('k-old', 5, 5, datetime('now', '-7 days'))").run();
  return { env: { DB: d1 } as any, raw };
}

const addReq = (body: unknown) => new Request('https://datawise-api/x', { method: 'POST', body: JSON.stringify(body) });

describe('GSC-seeded tracked keywords', () => {
  it('stores the seed as a labelled estimate, not a SERP check', async () => {
    const { env } = makeEnv();
    await handleAddKeywords(addReq({ keywords: ['padstow cottages'], initial_positions: { 'padstow cottages': 14 } }), env, 'u1', 'new');

    const rows = await (await handleListKeywords(env, 'u1', 'new')).json() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].position).toBe(14);
    expect(rows[0].position_source).toBe('gsc_seed');
    expect(rows[0].prev_position).toBeNull();
  });

  it('keeps a seeded project due, ahead of projects that already have live history', async () => {
    const { env } = makeEnv();
    await handleAddKeywords(addReq({ keywords: ['padstow cottages'], initial_positions: { 'padstow cottages': 14 } }), env, 'u1', 'new');

    const due = await selectDueRankProjects(env);
    expect(due.map((p) => p.id)).toEqual(['new', 'old']);
  });

  it('does not report movement from the seed to the first live check', async () => {
    const { env, raw } = makeEnv();
    await handleAddKeywords(addReq({ keywords: ['padstow cottages'], initial_positions: { 'padstow cottages': 14 } }), env, 'u1', 'new');
    const kwId = (raw.prepare("SELECT id FROM tracked_keywords WHERE project_id = 'new'").get() as any).id;
    raw.prepare("INSERT INTO rank_history (keyword_id, position, rank_group, checked_at) VALUES (?, 3, 3, datetime('now', '+1 minute'))").run(kwId);

    const rows = await (await handleListKeywords(env, 'u1', 'new')).json() as any[];
    expect(rows[0].position).toBe(3);
    expect(rows[0].position_source).toBeNull();
    expect(rows[0].prev_position).toBeNull();

    // and once it has a live check it is no longer due
    const due = await selectDueRankProjects(env);
    expect(due.map((p) => p.id)).toEqual(['old']);
  });
});
