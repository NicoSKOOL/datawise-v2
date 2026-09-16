import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../test-support/d1';
import type { NormalizedAnswer } from '../ai-engines';

// The scheduled tracker used to walk an unordered project list with no time
// limit once a week: the same few projects won every run and the rest never
// got a check (2026-09-16: 714 of 827 active queries had no scheduled check in
// three weeks). These tests pin the replacement: a daily slice that checks
// only the queries not scheduled-checked in the last 6 days, stalest project
// first, and stops cleanly at the wall-clock deadline.

const engineStub = { impl: null as null | ((...args: any[]) => Promise<any>), calls: [] as any[][] };
vi.mock('../ai-engines', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ai-engines')>();
  return {
    ...actual,
    runEngine: (...args: unknown[]) => {
      engineStub.calls.push(args);
      if (!engineStub.impl) throw new Error('runEngine stub not configured');
      return engineStub.impl(...args);
    },
  };
});

import { runScheduledAIChecks, AI_ENGINES_V2_FLAG, SCHEDULED_RECHECK_DAYS } from './ai-tracking';

const answer = (over: Partial<NormalizedAnswer> = {}): NormalizedAnswer => ({
  engine: 'chatgpt', model: 'gpt-x', answerText: 'nothing relevant', answerMarkdown: '', cited: [], retrieved: [], brands: [], ads: [], fanOut: [], ...over,
});

function makeEnv() {
  const { d1, raw } = createTestDb();
  const kv = new Map<string, string>([[AI_ENGINES_V2_FLAG, '1']]);
  raw.prepare("INSERT INTO users (id, email) VALUES ('u1', 'u1@example.com')").run();
  const env = {
    DB: d1,
    KV: { get: async (k: string) => kv.get(k) ?? null, put: async (k: string, v: string) => { kv.set(k, v); } },
    DATAFORSEO_EMAIL: 'x', DATAFORSEO_PASSWORD: 'y',
  } as any;

  let seq = 0;
  const addProject = (id: string, queries: string[], createdDaysAgo = 30) => {
    raw.prepare(
      "INSERT INTO seo_projects (id, user_id, name, domain, location_code, ai_tracking_enabled, ai_engines, created_at) VALUES (?, 'u1', ?, ?, 2840, 1, ?, datetime('now', ?))"
    ).run(id, id, `${id}.example.com`, JSON.stringify(['chatgpt']), `-${createdDaysAgo} days`);
    for (const text of queries) {
      seq += 1;
      raw.prepare(
        "INSERT INTO ai_tracked_queries (id, project_id, query_text, created_at) VALUES (?, ?, ?, datetime('now', ?))"
      ).run(`${id}-q${seq}`, id, text, `-${1000 - seq} minutes`);
    }
  };
  const addCheck = (queryText: string, runType: 'scheduled' | 'manual', daysAgo: number, status = 'absent') => {
    const q = raw.prepare('SELECT id FROM ai_tracked_queries WHERE query_text = ?').get(queryText) as { id: string };
    raw.prepare(
      "INSERT INTO ai_visibility_checks (query_id, engine, status, run_type, checked_at) VALUES (?, 'chatgpt', ?, ?, datetime('now', ?))"
    ).run(q.id, status, runType, `-${daysAgo} days`);
  };
  return { env, raw, kv, addProject, addCheck };
}

const checkedTexts = () => engineStub.calls.map(c => c[2] as string);
const farFuture = () => Date.now() + 60 * 60 * 1000;

beforeEach(() => { engineStub.impl = async () => answer(); engineStub.calls = []; });
afterEach(() => { vi.restoreAllMocks(); });

describe('runScheduledAIChecks (daily slice)', () => {
  it('checks only queries without a scheduled check in the last 6 days, stalest project first', async () => {
    const { env, raw, addProject, addCheck } = makeEnv();
    addProject('fresh', ['fresh q1', 'fresh q2'], 40);
    addProject('never', ['never q1'], 5);
    addProject('stale', ['stale q1'], 60);
    addCheck('fresh q1', 'scheduled', 2);
    addCheck('fresh q2', 'scheduled', 2);
    addCheck('stale q1', 'scheduled', 10);

    const totals = await runScheduledAIChecks(env, farFuture());

    expect(totals).toMatchObject({ projects_due: 2, projects: 2, queries_due: 2, checks: 2, deferred_queries: 0, deferred_projects: 0 });
    // A never-checked query outranks a 10-day-old one, regardless of project age.
    expect(checkedTexts()).toEqual(['never q1', 'stale q1']);
    const rows = raw.prepare("SELECT run_type, COUNT(*) n FROM ai_visibility_checks WHERE checked_at >= datetime('now', '-1 hour') GROUP BY run_type").all();
    expect(rows).toEqual([{ run_type: 'scheduled', n: 2 }]);
  });

  it('resumes a project with the queries it missed, not the whole project', async () => {
    const { env, addProject, addCheck } = makeEnv();
    addProject('p', ['done yesterday', 'missed last tick', 'never checked']);
    addCheck('done yesterday', 'scheduled', 1);
    addCheck('missed last tick', 'scheduled', SCHEDULED_RECHECK_DAYS + 1);

    const totals = await runScheduledAIChecks(env, farFuture());

    expect(totals).toMatchObject({ projects_due: 1, queries_due: 2, checks: 2 });
    expect(checkedTexts().sort()).toEqual(['missed last tick', 'never checked']);
  });

  it('treats a manual check as an extra, not as scheduled coverage', async () => {
    const { env, addProject, addCheck } = makeEnv();
    addProject('p', ['manually checked']);
    // Older than the 24h freshness skip, younger than the 6-day scheduled window.
    addCheck('manually checked', 'manual', 3);

    const totals = await runScheduledAIChecks(env, farFuture());

    expect(totals).toMatchObject({ queries_due: 1, checks: 1 });
    expect(checkedTexts()).toEqual(['manually checked']);
  });

  it('ignores projects with tracking disabled and queries that are inactive', async () => {
    const { env, raw, addProject } = makeEnv();
    addProject('off', ['off q1']);
    raw.prepare("UPDATE seo_projects SET ai_tracking_enabled = 0 WHERE id = 'off'").run();
    addProject('on', ['on active', 'on inactive']);
    raw.prepare("UPDATE ai_tracked_queries SET is_active = 0 WHERE query_text = 'on inactive'").run();

    const totals = await runScheduledAIChecks(env, farFuture());

    expect(totals).toMatchObject({ projects_due: 1, queries_due: 1, checks: 1 });
    expect(checkedTexts()).toEqual(['on active']);
  });

  it('defers everything when the deadline has already passed, without dropping it', async () => {
    const { env, addProject } = makeEnv();
    addProject('a', ['a q1', 'a q2']);
    addProject('b', ['b q1']);

    const totals = await runScheduledAIChecks(env, Date.now() - 1);

    expect(totals).toMatchObject({ projects_due: 2, projects: 0, queries_due: 3, checks: 0, deferred_projects: 2, deferred_queries: 3 });
    expect(engineStub.calls).toEqual([]);

    // Nothing was written, so the next tick sees the same due set.
    const next = await runScheduledAIChecks(env, farFuture());
    expect(next).toMatchObject({ projects: 2, checks: 3, deferred_queries: 0 });
  });

  it('stops between batches when the deadline passes mid-project and reports the remainder as deferred', async () => {
    const { env, addProject } = makeEnv();
    // 7 queries, v2 dispatches 5 at a time: the first batch runs, the second is deferred.
    addProject('big', Array.from({ length: 7 }, (_, i) => `big q${i + 1}`));

    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    engineStub.impl = async () => { now += 1_000; return answer(); };

    const totals = await runScheduledAIChecks(env, now + 500);

    expect(totals).toMatchObject({ queries_due: 7, checks: 5, deferred_queries: 2, deferred_projects: 0 });
    expect(checkedTexts()).toEqual(['big q1', 'big q2', 'big q3', 'big q4', 'big q5']);
  });

  it('does nothing when the KV kill switch is set', async () => {
    const { env, kv, addProject } = makeEnv();
    addProject('p', ['q']);
    kv.set('ai-tracking-paused', '1');
    expect(await runScheduledAIChecks(env, farFuture())).toBeNull();
    expect(engineStub.calls).toEqual([]);
  });
});
