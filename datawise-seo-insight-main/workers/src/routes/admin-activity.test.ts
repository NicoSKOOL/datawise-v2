import { describe, it, expect } from 'vitest';

import {
  handleActivityOverview, handleActivityFeatures, handleActivityUsers,
  handleActivityFunnel, handleActivityEvents, handleActivityUserDetail,
  handleActivitySummary,
} from './admin-activity';
import { createTestDb } from '../test-support/d1';

const nonAdmin = { id: 'u1', email: 'user@example.com', is_admin: 0 } as any;
const env = { DB: null } as any; // must never be touched for a non-admin

function req(url = 'https://api/x', method = 'GET') {
  return new Request(url, { method, ...(method === 'POST' ? { body: '{}' } : {}) });
}

describe('admin activity authz', () => {
  it('rejects non-admin users on every endpoint without touching the DB', async () => {
    const responses = await Promise.all([
      handleActivityOverview(req(), env, nonAdmin),
      handleActivityFeatures(req(), env, nonAdmin),
      handleActivityUsers(req(), env, nonAdmin),
      handleActivityFunnel(req(), env, nonAdmin),
      handleActivityEvents(req(), env, nonAdmin),
      handleActivityUserDetail(req(), env, nonAdmin, 'u2'),
      handleActivitySummary(req('https://api/x', 'POST'), env, nonAdmin),
    ]);
    // env.DB is null, so any DB access would have thrown instead of returning.
    for (const res of responses) expect(res.status).toBe(403);
  });

  it('rejects malformed date ranges for admins before querying', async () => {
    const admin = { id: 'a1', email: 'nico@airankingskool.com', is_admin: 1 } as any;
    const res = await handleActivityOverview(
      req('https://api/x?from=not-a-date&to=2026-07-02'), env, admin,
    );
    expect(res.status).toBe(400);
  });
});

// --- Opened vs Ran classification (real SQLite) ---

const admin = { id: 'admin', email: 'nico@airankingskool.com', is_admin: 1 } as any;
const DAY = '2026-09-10';
const RANGE = `from=${DAY}&to=${DAY}`;

type Ev = {
  user: string; feature: string; action: string; method: string;
  name?: string; credit?: number; outcome?: 'success' | 'blocked' | 'error'; category?: string;
};

function seed(raw: any, events: Ev[]) {
  for (const id of ['ua', 'ub', 'uc']) {
    raw.prepare('INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)')
      .run(id, `${id}@example.com`, id, `${DAY} 08:00:00`);
  }
  const insert = raw.prepare(
    `INSERT INTO app_events (event_name, event_category, user_id, feature, action, method,
       outcome, credit_cost, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  events.forEach((e, i) => {
    const sec = String(i % 60).padStart(2, '0');
    const min = String(Math.floor(i / 60) % 60).padStart(2, '0');
    insert.run(
      e.name || `${e.feature} ${e.action}`, e.category || 'product', e.user, e.feature, e.action,
      e.method, e.outcome || 'success', e.credit ?? 0, `${DAY} 10:${min}:${sec}`,
    );
  });
}

const times = (n: number, e: Ev): Ev[] => Array.from({ length: n }, () => e);

function fixture() {
  const { d1, raw } = createTestDb();
  seed(raw, [
    // content_planner: lots of page loads + autosaves, 1 real create.
    ...times(20, { user: 'ua', feature: 'content_planner', action: 'use', method: 'GET' }),
    ...times(5, { user: 'ua', feature: 'content_planner', action: 'use', method: 'PATCH' }),
    { user: 'ua', feature: 'content_planner', action: 'create', method: 'POST', name: 'Content Planner Created' },
    // keyword_research: 3 paid queries by 2 users (one blocked), 1 GET.
    { user: 'ua', feature: 'keyword_research', action: 'query', method: 'POST', name: 'Keyword Query', credit: 1 },
    { user: 'ub', feature: 'keyword_research', action: 'query', method: 'POST', name: 'Keyword Query', credit: 1 },
    { user: 'ub', feature: 'keyword_research', action: 'query', method: 'POST', name: 'Keyword Query', outcome: 'blocked' },
    { user: 'ub', feature: 'keyword_research', action: 'view', method: 'GET' },
    // site_audit: credit-using GET counts as ran (and opened).
    { user: 'uc', feature: 'site_audit', action: 'run', method: 'GET', name: 'Site Audit Run', credit: 2 },
    // Plumbing POSTs: never ran.
    { user: 'uc', feature: 'integrations', action: 'connect', method: 'POST' },
    { user: 'uc', feature: 'rank_tracking', action: 'sync', method: 'POST' },
    { user: 'uc', feature: 'promo', action: 'redeem', method: 'POST' },
    // Non-product rows are ignored by product aggregates.
    { user: 'ua', feature: 'admin', action: 'query', method: 'POST', category: 'admin' },
  ]);
  return { env: { DB: d1 } as any, raw };
}

const get = (path: string) => new Request(`https://api/api/admin/activity/${path}`);

describe('admin activity ran vs opened', () => {
  it('features endpoint counts ran/opened and sorts by ran', async () => {
    const { env } = fixture();
    const res = await handleActivityFeatures(get(`features?${RANGE}`), env, admin);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    const byFeature = Object.fromEntries(body.features.map((f: any) => [f.feature, f]));

    expect(byFeature.content_planner).toMatchObject({ events: 26, opened: 20, ran: 1, ran_users: 1 });
    expect(byFeature.keyword_research).toMatchObject({ events: 4, opened: 1, ran: 3, ran_users: 2, active_users: 2 });
    expect(byFeature.site_audit).toMatchObject({ opened: 1, ran: 1, credits_used: 2 });
    expect(byFeature.integrations).toMatchObject({ ran: 0 });
    expect(byFeature.rank_tracking).toMatchObject({ ran: 0 });
    expect(byFeature.promo).toMatchObject({ ran: 0 });
    expect(byFeature.admin).toBeUndefined();

    // Ranked by ran, not by raw events (content_planner has the most rows).
    expect(body.features[0].feature).toBe('keyword_research');
    const ranOrder = body.features.map((f: any) => f.ran);
    expect([...ranOrder].sort((a, b) => b - a)).toEqual(ranOrder);
  });

  it('features endpoint returns top_actions by ran with users, credits and fail rate', async () => {
    const { env } = fixture();
    const body = await (await handleActivityFeatures(get(`features?${RANGE}`), env, admin)).json() as any;
    expect(body.top_actions[0]).toMatchObject({
      feature: 'keyword_research', event_name: 'Keyword Query', action: 'query',
      ran: 3, users: 2, credits_used: 2, failures: 1, fail_rate: 33.3,
    });
    const names = body.top_actions.map((a: any) => a.event_name);
    expect(names).toContain('Content Planner Created');
    expect(names).toContain('Site Audit Run');
    expect(body.top_actions.some((a: any) => ['connect', 'sync', 'redeem'].includes(a.action))).toBe(false);
    expect(body.top_actions.some((a: any) => a.action === 'use')).toBe(false);
  });

  it('overview totals include ran/opened events and ran users', async () => {
    const { env } = fixture();
    const body = await (await handleActivityOverview(get(`overview?${RANGE}`), env, admin)).json() as any;
    expect(body.totals).toMatchObject({
      total_events: 34, ran_events: 5, opened_events: 22, ran_users: 3, active_users: 3, credits_used: 4,
    });
  });

  it('users endpoint picks top_feature by ran and reports ran_events', async () => {
    const { env } = fixture();
    const body = await (await handleActivityUsers(get(`users?${RANGE}&sort=ran`), env, admin)).json() as any;
    const byId = Object.fromEntries(body.users.map((u: any) => [u.id, u]));
    // ua ran content_planner once and keyword_research once: the tie breaks on
    // total events, so content_planner wins.
    expect(byId.ua.ran_events).toBe(2);
    expect(byId.ua.top_feature).toBe('content_planner');
    expect(byId.ub.ran_events).toBe(2);
    expect(byId.ub.top_feature).toBe('keyword_research');
    expect(byId.uc.ran_events).toBe(1);
    // uc: site_audit ran once; plumbing rows (1 each) did not, so ran wins over raw count.
    expect(byId.uc.top_feature).toBe('site_audit');
    const ran = body.users.map((u: any) => u.ran_events);
    expect([...ran].sort((a, b) => b - a)).toEqual(ran);
  });

  it('users top_feature prefers ran over raw event volume', async () => {
    const { d1, raw } = createTestDb();
    seed(raw, [
      ...times(10, { user: 'ua', feature: 'content_planner', action: 'use', method: 'GET' }),
      { user: 'ua', feature: 'ai_visibility', action: 'run', method: 'POST' },
      // ub ran nothing: falls back to most events.
      ...times(3, { user: 'ub', feature: 'site_audit', action: 'view', method: 'GET' }),
      { user: 'ub', feature: 'backlinks', action: 'view', method: 'GET' },
    ]);
    const body = await (await handleActivityUsers(get(`users?${RANGE}`), { DB: d1 } as any, admin)).json() as any;
    const byId = Object.fromEntries(body.users.map((u: any) => [u.id, u]));
    expect(byId.ua.top_feature).toBe('ai_visibility');
    expect(byId.ub.top_feature).toBe('site_audit');
    expect(byId.ub.ran_events).toBe(0);
  });

  it('include_opened=0 drops page loads from user detail and event logs', async () => {
    const { env } = fixture();
    const all = await (await handleActivityUserDetail(get(`users/ua?${RANGE}`), env, admin, 'ua')).json() as any;
    expect(all.events.some((e: any) => e.method === 'GET')).toBe(true);
    expect(all.summary).toMatchObject({ total_events: 27, ran_events: 2, opened_events: 20 });

    const filtered = await (await handleActivityUserDetail(
      get(`users/ua?${RANGE}&include_opened=0`), env, admin, 'ua',
    )).json() as any;
    expect(filtered.events.length).toBe(8); // 5 PATCH + create + query + admin row
    expect(filtered.events.some((e: any) => e.event_category === 'product' && e.method === 'GET')).toBe(false);

    const logs = await (await handleActivityEvents(get(`events?${RANGE}&limit=200&include_opened=0`), env, admin)).json() as any;
    expect(logs.events.length).toBe(35 - 22);
    expect(logs.events.some((e: any) => e.event_category === 'product' && e.method === 'GET')).toBe(false);

    const logsAll = await (await handleActivityEvents(get(`events?${RANGE}&limit=200`), env, admin)).json() as any;
    expect(logsAll.events.length).toBe(35);
  });

  it('funnel counts a signup as "ran a tool" only when they ran something, not just opened', async () => {
    const { env, raw } = fixture();
    // ud signed up and only opened screens, on two different days.
    raw.prepare('INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)')
      .run('ud', 'ud@example.com', 'ud', `${DAY} 08:00:00`);
    const insert = raw.prepare(
      `INSERT INTO app_events (event_name, event_category, user_id, feature, action, method, outcome, credit_cost, created_at)
       VALUES ('Site Audit Viewed', 'product', 'ud', 'site_audit', 'view', 'GET', 'success', 0, ?)`,
    );
    insert.run(`${DAY} 09:00:00`);
    insert.run('2026-09-11 09:00:00');

    const body = await (await handleActivityFunnel(get('funnel?from=2026-09-10&to=2026-09-11'), env, admin)).json() as any;
    const steps = Object.fromEntries(body.steps.map((s: any) => [s.key, s.users]));
    expect(steps).toMatchObject({ signed_up: 4, ran_tool: 3, returned: 1 });
  });
});
